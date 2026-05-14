# AGENTS.md — for Claude Code, Codex, and other AI coding assistants

Boast was vibe-coded; treat this as the rulebook so the next vibe-coded
feature lands cleanly.

> **Read first:** [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the map,
> [`README.md`](./README.md) for what the product is.

---

## Mental model in one paragraph

Single-page Vite/React/TS app on top of Supabase (Postgres + Auth +
Realtime + Storage + edge functions). One React context (`StoreProvider`)
is the only state container. Rating math is pure TypeScript with a
plpgsql twin on the server for chunked rebuilds. Cloud mode lazy-loads
matches — never assume the in-memory `matches` array is the full table.

---

## Workflow expectations

1. **Plan before edits.** State which files you're going to touch and why.
   Don't auto-implement on every prompt — confirm scope first.
2. **Use the helpers.** Before adding a regex, a `.filter`, or an inline
   form-validation block, look in `src/lib/` and `src/components/`:
   - Token search →  `filterByTokens` (`src/lib/search.ts`)
   - Country/city/year validation →  `parseProfileFields`
     (`src/lib/profile-validation.ts`)
   - Level / date / initials formatting →  `src/lib/format.ts`
   - "(P)" provisional badge →  `<ProvisionalTag>` (`src/components/`)
   - Club/group 2-letter tile →  `<OrgAvatar kind="club|group">`
   - Player avatar / initials →  `<PlayerAvatar>` and `playerSubtitle`
   - Match list item →  `<MatchCard>`
3. **Write no comments unless the *why* is non-obvious.** Comments that
   restate the code, narrate the change, or reference the current task
   get reverted. Comments that pin a server-side mirror, an RLS edge
   case, or a deliberate workaround stay.
4. **Don't add new state libraries.** If something feels global, it goes
   on the `StoreProvider` value. Component-local state stays local.
5. **Don't add a "compat" shim.** Rewrite the call sites; the export/
   import in `Settings → Backup & restore` is the live-data safety net.

---

## Database changes

`supabase/schema.sql` is idempotent and authoritative. To change the DB:

1. Edit `schema.sql` in place (use `add column if not exists`,
   `create or replace function`, etc).
2. Add a dated copy of just the delta to `supabase/migrations/` so a
   live project can apply only the new bits.
3. Update `src/types.ts` (Zod schema) and
   `src/lib/supabase/mappers.ts` (both `from*Row` and `to*Row`).
4. If you added an RPC, write a typed wrapper in
   `src/lib/supabase/<area>.ts` (don't call `.rpc()` from pages).
5. If you touched the rating math, update `src/lib/rating/update.ts`
   *and* the `compute_level_update` plpgsql function. They drift silently
   — there's no test that compares them.

---

## Adding a UI primitive

Three rules:

- **One file, one component family.** Put related sub-components in the
  same file unless they're reused across files.
- **Tailwind first.** Only fall back to inline `style={}` for dynamic
  pixel sizes (avatars, charts).
- **Honour `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-link`,
  `.btn-link-danger`, `.input`, `.card`, `.tag`, `.label`** in
  `src/index.css` — they exist so themes and tap-target heights stay
  consistent.

---

## Anti-patterns we've already cleaned up — don't reintroduce

| Don't | Do |
| --- | --- |
| Inline `tokens.every(...)` filters | `filterByTokens(items, q, getHay)` |
| Inline year/country/city validation | `parseProfileFields(...)` |
| `<span className="tag">P</span>` | `<ProvisionalTag />` |
| Hand-rolled `bg-violet-100 text-violet-700` 2-letter tiles | `<OrgAvatar kind="group">` |
| Hand-rolled initials in JSX | `initialsFor(name)` from `lib/format` |
| `MATCH_TYPES = ['friendly', ...]` redefined per file | `MATCH_TYPE_KEYS` from `types.ts` |
| `URL.createObjectURL` cleanup boilerplate | (keep inline; it's small and always paired with `revokeObjectURL`) |
| `console.log` left in code | remove before committing |

---

## Testing & verification

```bash
npm test          # rating algorithm — fast, run on every change
npm run build     # tsc -b && vite build — catches type errors
npm run lint      # ESLint — there are ~34 pre-existing errors; don't add more
```

There is no UI test suite. For UI changes, run `npm run dev` and walk the
flow you changed. State explicitly when you couldn't test something
end-to-end.

---

## `can_write_match` and the three admin tiers

The SQL helper `public.can_write_match(uid, p_a, p_b)` returns TRUE when
any of the following is true:
1. `uid` is a global admin (`is_admin(uid)`).
2. `uid` is a club admin for at least one of the two players' clubs.
3. `uid` administers a group that contains BOTH `p_a` and `p_b` as
   members (`is_group_admin_for_pair`).

This single helper powers the matches UPDATE / DELETE / INSERT RLS
policies AND the `confirm_match` SECURITY DEFINER RPC override, so a
single edit in SQL propagates everywhere.

Client mirror: `canWriteMatch` in the store implements the same three
branches. It reads `myClubAdminSlugs` (string[]) and
`myGroupAdminScope` (Map<groupId, Set<playerId>>) which are fetched
once on profile load via `fetchMyClubAdminSlugs` /
`fetchMyGroupAdminScope`. If you add a fourth tier, update both the
SQL helper and the client `canWriteMatch` — they MUST agree.

---

## Provisional is `matchesPlayed < threshold AND NOT seededRating`

Players who registered with an explicit SquashLevels.com / LevelTech
rating ("I have a rating" in onboarding) get `seeded_rating = true` on
both profile + player rows and are **never provisional** — they
participate in symmetric updates from match 1.

Use `isProvisional(player, settings)` from
[`src/lib/rating/levels.ts`](src/lib/rating/levels.ts) **everywhere** —
never reach for the raw `matchesPlayed < provisionalThreshold` check.
The helper also handles the cloud-lazy-load case where `matchesPlayed`
is null. Mirrored server-side in `rebuild_levels_chunk` (the plpgsql
twin); if you tweak the formula in one place, update the other.

See [`openspec/specs/rating/spec.md` §Provisional](openspec/specs/rating/spec.md).

---

## Desktop nav: admin entries live in the "Admin ▾" dropdown

The desktop top nav fits four primary tabs (Leaderboard / Clubs /
Groups / History) + Activity + a brand-coloured "Log match" CTA + the
user pill. Admin-only entries — currently **Audit log** and **Admin
settings** — collapse into a single "Admin ▾" dropdown
(`AdminMenu` in `Layout.tsx`) to avoid horizontal overflow at typical
laptop widths.

When you add a new admin-only nav entry:

- If it's relevant to global admins only → add it as an item inside
  `AdminMenu`'s dropdown (next to Admin settings), gated on `isAdmin`.
- If it's relevant to club admins too → add it inside `AdminMenu`
  gated on `canSeeAudit` (which already means "global admin or any
  club admin") and add it to the mobile More sheet via `SheetLink`.
- If it's for every signed-in user → add as a top-level NavLink in
  the main `<nav>` block, next to Activity.

The mobile More sheet stays vertical and exposes everything directly —
no nested dropdown needed there.

---

## Audit log captures every write

A generic AFTER trigger (`audit_row_change`) writes one row to
`public.audit_events` per INSERT/UPDATE/DELETE on the nine load-bearing
tables (profiles, players, matches, challenges, clubs, club_admins,
groups, group_members, settings). Reads go through the
`list_audit_events` RPC; the table itself has no SELECT policy.

If you add a new table that should be auditable: attach the same
trigger and add a branch in `audit_row_change` to compute its
`subject_player_ids / subject_club_slugs / subject_group_ids` denorm
arrays. Without those arrays scoped (non-global) admins won't see the
events.

If you add a server-side trigger that cascades to one of the audited
tables and the cascade should not produce its own audit row, wrap the
write with `set_config('boast.audit_skip', 'true', true)` like
`sync_player_from_profile` does. Otherwise scoped admins will see a
suspicious "system did X" event with no obvious actor.

Privileged events (is_admin-only profile changes, settings writes) are
flagged at trigger time and are hidden from scoped admins regardless of
their other scope overlap. See
[openspec/specs/audit/spec.md](openspec/specs/audit/spec.md).

---

## Admin can edit another user's profile (limited fields)

The "Edit profile (admin)" button on a `/players/:id` page (for claimed
players, when viewer is global admin and isn't the target) opens
`AdminEditProfileModal`. It edits `full_name`, `phone`, `country`, `city`,
`club`, `birth_year`, `gender`, `dominant_hand`, `starting_level`, and
`seeded_rating` (the skip-provisional flag).

Deliberately **not** editable by admin:
- `username` — backs shareable URLs.
- `email` — auth.users canonical + auto-claim key.
- `avatar_url` — storage bucket policy is owner-write only.
- `is_admin` — use Settings → Admins.

The modal calls `updateProfile(...)` directly (NOT `store.saveProfile`,
which mutates the *signed-in* user's profile/myPlayer state — wrong for
admin-editing-someone-else). The `profiles_sync_player` AFTER UPDATE
trigger mirrors the change onto the target's linked player row server-side;
we call `store.refresh()` afterwards to bust the in-memory player cache.

---

## Unclaimed player creation requires email + admin confirmation for self-wins

- `create_unclaimed_player` (server RPC) **requires** `p_email`. The Log Match
  "+ Add new player" form gates the submit button on email. Don't relax this
  — email is what wires the future auto-claim (`ensure_player_for_profile`
  matches by normalised email) and powers dedup. A stub with no email is an
  unreachable ghost.
- Pending matches where either participant is unclaimed (`user_id IS NULL`)
  are **excluded** from `auto_confirm_aged_matches` and require a global
  admin to call `confirm_match`. The Activity page surfaces them in the
  Action-needed section for admins with a "Awaiting admin confirmation"
  hint. Self-loss recordings still auto-confirm at insert time per the
  trigger — only non-admin self-WINs against unclaimed players get the
  admin-gate treatment.
- `confirm_match` allows global admins to confirm any pending match,
  including one they themselves recorded. This is the path admins use to
  step in for an unclaimed opponent.

---

## Player deletion is global-admin-only and state-aware

- Only **global admins** may delete a player (`is_admin = true`). Club admins
  can add and edit but cannot delete — the FK cascade (matches against
  non-club players, group memberships, challenges) is too wide. Enforced by
  the `admin delete player` RLS policy and by `requireAdmin()` in
  `store.removePlayer`.
- The Roster Delete action is **state-aware**:
  - Claimed (`user_id` set) → routes through the `admin_delete_user` RPC so
    `auth.users` + `profiles` + `players` all go. Otherwise the user can
    still sign in (their profile survives) but has no player row.
  - Unclaimed (`user_id IS NULL`) → plain `DELETE FROM players`; cascades
    handle the rest.
- **Never** call `backend.deletePlayer(id)` directly on a claimed player —
  the resulting orphan state is the bug we just fixed.
- After any player deletion, opponents' `current_level` / `matches_played`
  are stale until **Admin → Rebuild levels** runs. The History page already
  surfaces this hint; Roster does not (acceptable trade-off — deleting from
  Roster is rare).

---

## Cloud mode: match data is lazy-loaded

Under cloud mode `store.matches` is **empty** — matches are fetched per
page via `fetchMatchesPage` / `fetchRecentMatches`. That means the
`recomputeAll` result has `matchesPlayed: 0` and `currentLevel: undefined`
for everyone. **Always** prefer the server-managed columns and fall back
to the recompute (for local mode):

```ts
const currentLevel = p.currentLevel ?? s?.currentLevel ?? p.startingLevel
const matchesPlayed = p.matchesPlayed ?? s?.matchesPlayed ?? 0
```

Same pattern applies to per-player tables in `Leaderboard`, `Roster`,
`ClubProfile`, `GroupProfile`, `PlayerProfile`.

---

## Where the gotchas live

- `src/state/store.tsx` — three pre-existing `react-hooks/*` lint errors,
  intentional fast-refresh boundary issue at the bottom (the
  `useStore` hook colocated with `StoreProvider`). Adding new exports
  here will multiply the warning; if you must, split it.
- `src/lib/storage/backend.ts` — the cloud and local backends share an
  interface but local-mode aux arrays (clubs, groups) are empty stubs.
- `src/components/MatchCard.tsx` — both perspectives (viewer-side flip,
  no-flip) are supported via the optional `viewerId` prop. Don't fork
  this for a "my-perspective card" elsewhere.
- `src/pages/Settings.tsx` — three small admin-management sub-components
  (admins, club admins, groups) live in this file. They share a pattern;
  if a fourth manager appears, extract a generic `<AdminListPanel>`.
- `supabase/schema.sql` — 2 000+ lines of idempotent SQL. Use `Ctrl+F`,
  not vibes.

---

## Handy file paths

| Need | File |
| --- | --- |
| Routes | `src/App.tsx` |
| Bottom nav, header, more-sheet | `src/components/Layout.tsx` |
| Onboarding wizard | `src/components/OnboardingModal.tsx` |
| Log a match | `src/pages/LogMatch.tsx` |
| Match cards everywhere | `src/components/MatchCard.tsx` |
| Player profile + level chart | `src/pages/PlayerProfile.tsx` |
| Algorithm constants | `src/types.ts` (defaults), `src/pages/Settings.tsx` (UI) |
| RLS + triggers + RPCs | `supabase/schema.sql` |
| Admin emails (Resend) | `supabase/functions/send-match-email/index.ts` |
| Open-Graph share preview | `supabase/functions/share/index.ts` |

---

If a refactor would touch more than ~10 files, propose the plan first
and get a thumbs-up before mass-edits.
