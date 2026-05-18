## Context

The current admin "delete user" path is a single cascade implemented by `admin_delete_user(target_user_id)` (added 2026-05-10). It deletes the linked `players` row first — which transitively deletes every `matches`, `group_members`, and `challenges` row referencing that player via `on delete cascade` FKs — and then deletes the `auth.users` row, which cascades the `profiles` row. The UI surfaces this from two places: Settings → Global Admins (`AdminManager.remove` in [src/pages/Settings.tsx](src/pages/Settings.tsx)) and Roster (`remove` in [src/pages/Roster.tsx](src/pages/Roster.tsx)), both behind a single `window.confirm()`. After any such delete, opponents' `current_level` and `matches_played` are stale until the admin runs "Rebuild levels."

The auth-permissions spec already acknowledges a milder "soft" path exists *as a side effect of the schema*: if `auth.users` is deleted directly (e.g. via the Supabase console), `players.user_id` goes to NULL via the existing `references auth.users(id) on delete set null` FK, the player becomes unclaimed, and history is preserved (Player RLS scenario "Auth user is deleted"). The app just doesn't expose this. We want to expose it as the *default* admin delete, and reserve the cascading hard delete for true cleanup.

## Goals / Non-Goals

**Goals:**
- Make soft delete the default admin action: removes auth+profile, leaves the player row unclaimed with all match/challenge/group history intact.
- Keep hard delete available as an explicit, more dangerous option for spam / merge-cleanup.
- Make the two intents visually distinct in the UI — not the same button with one scary confirm.
- Preserve the existing claim flow so a soft-deleted user can re-sign-up with the same email and re-claim their player (auto-claim on profile creation + `claim_player_by_id` both work without changes, because the player row is left intact with its `email`).
- Same admin-only / no-self-delete guardrails on both RPCs.

**Non-Goals:**
- Self-service "delete my account" UI for regular users (admin-only for now).
- Anonymizing soft-deleted player rows — name/email/club are intentionally preserved to enable re-claim.
- The profile-merge flow itself. Soft+hard delete is a prerequisite; the merge is a separate change.
- Any change to how matches / challenges / group_members cascade — those FKs stay as-is.
- Any change to the unclaimed-player delete path (no auth/profile exists to detach from; "soft" doesn't apply).

## Decisions

### Decision 1: New RPC `admin_soft_delete_user`, leave `admin_delete_user` alone

Add a new SECURITY DEFINER function that deletes only `auth.users` (cascading the profile via the existing FK), without touching the players row. The existing FK `players.user_id … on delete set null` does the rest: the player row stays, `user_id` becomes NULL, the player becomes unclaimed.

**Alternatives considered:**
- *Overload `admin_delete_user` with a `mode` parameter*: rejected. The current RPC's first statement is `delete from public.players where user_id = …` — flipping behavior under a flag is the kind of thing that goes wrong silently. Two functions, two names, two grants. Easier to audit, easier to revoke independently.
- *Do it client-side (call `auth.users` delete directly)*: rejected. Clients can't touch `auth` schema without admin keys; we route everything through SECURITY DEFINER RPCs.

**Body sketch:**
```sql
create or replace function public.admin_soft_delete_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
set statement_timeout = '30s'
as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'admin only'; end if;
  if target_user_id = auth.uid()    then raise exception 'cannot delete yourself'; end if;
  if target_user_id is null         then raise exception 'target_user_id is required'; end if;

  -- Only auth.users + profiles. The players row stays; user_id becomes NULL
  -- via the existing on-delete-set-null FK. Matches / challenges /
  -- group_members are untouched.
  delete from auth.users where id = target_user_id;
end;
$$;
grant execute on function public.admin_soft_delete_user(uuid) to authenticated;
```

### Decision 2: Player details are NOT anonymized on soft delete

The soft-deleted player row keeps its `name`, `email`, `club`, `avatar_url`, `phone`, `birth_year`, `gender`, `dominant_hand`. Rationale (per user direction):
- The whole point of soft delete is that the same person can come back. The auto-claim path in `profiles_ensure_player` matches on **normalized email**; the existing claim_player_by_id flow works on player id. Anonymizing the email would break the auto-claim and force them to find their old player by name.
- Leaderboards and match cards already show name+club from the player row. Wiping those would surface an ugly "Former player" placeholder for every historical match, which is worse UX than just letting the name stay.
- True privacy-mode anonymization is a future concern; if a user explicitly requests "scrub my name from history," that's a separate flow (and arguably belongs with self-service delete, which is out of scope here).

### Decision 3: Two-RPC `removePlayer(id, mode)` instead of two store actions

Single entry point in the store, branches on `mode`. For unclaimed players (`!target.userId`), `mode` is forced to `'hard'` — no soft path exists. For claimed players, default to `'soft'` and let the UI pass `'hard'` when the admin explicitly chooses it.

On soft delete, the local state update keeps the player row in `players[]` (with `userId` cleared), and does NOT filter matches. On hard delete, both are dropped as today.

### Decision 4: Modal UI, not a second confirm

Replace the single `window.confirm()` in both Settings AdminManager and Roster with a small inline modal that:
- Has two buttons: "Soft delete (keep matches)" and "Hard delete (remove everything)".
- Each button has a one-line description of its consequence (matches preserved vs. matches deleted + rebuild required).
- Hard-delete button is styled destructive (red) and requires a second click-through confirm to avoid fat-fingering.

Two confirms on the same button can't communicate "these are two different actions" — only a modal can. The Roster page already has destructive-action patterns we can mirror.

### Decision 5: Spec lives in `auth-permissions`, not a new capability

This is an extension of an existing requirement (Player RLS § admin delete), not a new capability. Modify the existing requirement and add scenarios; don't fork a new spec.

## Risks / Trade-offs

- **Risk**: Admin picks the wrong mode and hard-deletes a user whose history matters. → Mitigation: soft is the visually-preferred default in the modal; hard requires an extra confirm-through with explicit text about what will be deleted.
- **Risk**: Soft-deleted player keeps PII (email, phone) in the players row, which some users may consider "not really deleted." → Mitigation: documented in the spec as intentional; not a regression vs. today (today's behavior was *more* destructive but didn't offer a privacy-preserving alternative anyway). If we add user-initiated delete later, that flow can offer anonymization.
- **Risk**: An admin soft-deletes themselves accidentally. → Mitigation: both RPCs reject `target_user_id = auth.uid()` (same guardrail as today).
- **Risk**: A re-claimed player keeps stale identity from the old session (e.g. their old club is wrong now). → Acceptable: claim is by email, and the user can edit their profile post-claim. The `profiles_sync_player` trigger handles name/club mirroring on subsequent edits.
- **Trade-off**: Two RPCs instead of one. Small surface-area cost; worth it for auditability of which path was taken.

## Migration Plan

1. Add a single forward-only migration `2026-05-18-admin-soft-delete-user-rpc.sql` defining the new RPC; idempotent via `create or replace`. Append the same SQL to `supabase/schema.sql` for rebuilds-from-zero parity.
2. Ship client + UI changes in the same PR so the new button never points at a missing RPC.
3. No data migration needed. Existing user records and FKs are unchanged.
4. **Rollback**: `drop function public.admin_soft_delete_user(uuid);` plus reverting the UI. The hard-delete path (`admin_delete_user`) is unchanged, so the worst case is "admin loses the soft option" — no data corruption.
