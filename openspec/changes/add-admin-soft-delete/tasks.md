## 1. Database — new soft-delete RPC

- [x] 1.1 Create migration `supabase/migrations/2026-05-18-admin-soft-delete-user-rpc.sql` defining `public.admin_soft_delete_user(target_user_id uuid)` as SECURITY DEFINER, `search_path = public`, `statement_timeout = '30s'`. Body: admin check, self-delete check, null check, then `delete from auth.users where id = target_user_id`. Grant execute to `authenticated`.
- [x] 1.2 Append the same `create or replace function … admin_soft_delete_user …` + grant to `supabase/schema.sql` so rebuilds-from-zero match the migration. Place it adjacent to the existing `admin_delete_user` definition for discoverability. (Also folded `admin_delete_user` itself into `schema.sql` — it was previously migration-only.)
- [ ] 1.3 Manually verify in Supabase SQL editor that (a) calling as a non-admin raises `admin only`, (b) calling with `target_user_id = auth.uid()` raises `cannot delete yourself`, (c) calling with NULL raises, (d) calling as admin on a real test user deletes only auth/profile and leaves the player row with `user_id IS NULL`. _[Deferred — manual user step.]_

## 2. Client lib

- [x] 2.1 Add `softDeleteUser(userId: string): Promise<void>` to [src/lib/supabase/profile.ts](src/lib/supabase/profile.ts) next to the existing `deleteUserCompletely`. Body: `sb.rpc('admin_soft_delete_user', { target_user_id: userId })`, throw on error. Mirror the JSDoc style of `deleteUserCompletely` and call out that match/challenge/group history is preserved.

## 3. Store — `removePlayer` accepts a mode

- [x] 3.1 Update the `removePlayer` signature in [src/state/store.tsx](src/state/store.tsx) (and its type in `StoreCtx`) to `removePlayer(id: string, mode?: 'soft' | 'hard'): Promise<void>`. Default `mode` is `'soft'`.
- [x] 3.2 In `removePlayer`, after the `requireAdmin()` call, branch by `target.userId` and `mode`:
  - `target.userId && mode === 'soft'` → `await softDeleteUser(target.userId)`; in local state, update the player row to set `userId = null` (do NOT remove the player from `players[]`); do NOT touch `matches[]`. If the player was `myPlayer`, clear `myPlayer`.
  - `target.userId && mode === 'hard'` → existing path: `await deleteUserCompletely(target.userId)`; remove player from `players[]` and drop matches.
  - `!target.userId` → existing path: `await backend.deletePlayer(id)`; remove player and drop matches. `mode` is ignored.
- [x] 3.3 Update the inline comment above the branch to describe all three cases (soft claimed / hard claimed / unclaimed) and reference the auth-permissions spec section.

## 4. UI — shared delete modal

- [x] 4.1 Create `src/components/DeleteUserModal.tsx` exporting `DeleteUserModal({ open, onClose, onConfirm, displayName, email, isClaimed })`. Renders:
  - Title: `Delete <displayName>`
  - Two stacked cards / buttons (only the soft card is shown when `isClaimed === true`; for `isClaimed === false` render a single hard-delete confirm matching today's wording):
    - **Soft delete** — primary button label "Delete account, keep matches". Body: "Removes their sign-in and profile. Their player record stays as unclaimed, with name and history intact, so they can sign back in later with the same email and reclaim it."
    - **Hard delete** — destructive button label "Delete everything". Body: "Also deletes every match, challenge, and group membership they were part of. Opponents' levels will be stale until you run Rebuild levels. This cannot be undone." Requires a second click-through "Confirm hard delete" before invoking `onConfirm('hard')`.
  - Cancel button.
  - `onConfirm(mode: 'soft' | 'hard')` is called by the parent which then awaits the store action and closes the modal.
- [x] 4.2 Style consistent with existing modals on the project (e.g., `AvatarCropper`, the existing import-confirm pattern in Settings). Reuse `Alert` for the destructive-confirm step where appropriate. (Mirrored `EditMatchDialog` shell + `Alert` for the destructive-warn step.)

## 5. UI — Settings → Admins manager

- [x] 5.1 In [src/pages/Settings.tsx](src/pages/Settings.tsx) `AdminManager`, replace the `window.confirm()` in `remove(p: Profile)` with state that opens `DeleteUserModal`. Profile rows in this list always have a sign-in (`isClaimed === true` for the modal), so both soft and hard options render.
- [x] 5.2 The `onConfirm(mode)` handler calls the new store method **indirectly**: AdminManager already manages its own profile list (not `players`), so it MUST call the RPC layer directly — `softDeleteUser(p.id)` or `deleteUserCompletely(p.id)` — and then `refresh()` to sync players/matches state. Update local `profiles` state to drop the row in both cases (in soft, the profile row really is gone; the player stays but isn't shown here).
- [x] 5.3 After a successful soft delete, surface a toast: "Account deleted. Their player record remains unclaimed and can be reclaimed by signing in again with the same email."

## 6. UI — Roster

- [x] 6.1 In [src/pages/Roster.tsx](src/pages/Roster.tsx) `remove(p: Player)`, branch on `p.userId`: claimed → modal with both options; unclaimed → modal in `isClaimed={false}` mode (single confirm). Both routes call `removePlayer(p.id, mode)` (mode forced to `'hard'` for unclaimed).
- [x] 6.2 Update the explanatory comment block above `remove` to describe the three cases (soft claimed / hard claimed / unclaimed) and reference the auth-permissions spec.

## 7. Spec & docs

- [x] 7.1 Apply the delta from `openspec/changes/add-admin-soft-delete/specs/auth-permissions/spec.md` into `openspec/specs/auth-permissions/spec.md` (replace the existing "Requirement: Player RLS" block with the modified version, including all scenarios). _[Happens at archive time per OpenSpec workflow; delta authored.]_
- [x] 7.2 Update `AGENTS.md` if it references the old single-mode admin delete, to mention the soft/hard split.
- [x] 7.3 Update any architecture overview (`ARCHITECTURE.md` if present) section that describes user lifecycle / deletion. _[ARCHITECTURE.md does not describe deletion; nothing to change.]_

## 8. Verification

- [x] 8.1 Type-check passes (`npx tsc -b` — clean).
- [x] 8.2 Build passes (`npm run build` — green; 789 modules, ~1.5s).
- [ ] 8.3 Manual UI test in browser dev server:
  - As admin, soft-delete a test user from Settings → Admins. Verify: their profile row disappears from the admin list; their player row appears as unclaimed in Roster; their matches still show on the leaderboard with the same player name; opponents' levels unchanged.
  - As admin, sign in as that user again with the same Google email; OnboardingModal should auto-claim the surviving player and historical matches should appear in their profile.
  - As admin, hard-delete a different test user. Verify: profile, player, and all their matches are gone; opponents' levels drift until Rebuild.
  - As admin, attempt to soft-delete yourself — UI hides the Delete button on your own row; if the RPC is invoked directly it should reject with `cannot delete yourself`.
  _[Deferred — manual user step.]_
- [x] 8.4 Run the project's `openspec validate add-admin-soft-delete` (or equivalent OpenSpec validation) and ensure it passes before requesting archive. _(Passed: `Change 'add-admin-soft-delete' is valid`.)_
