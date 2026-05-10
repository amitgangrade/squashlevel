## Why

The auth/permissions model is the project's most-misunderstood area. It was rebuilt on 2026-05-08 from a single-owner magic-link gate (hardcoded `OWNER_EMAIL`, a `canEdit` flag in the store) to a multi-user Google-OAuth model with `profiles.is_admin` and per-player ownership via `players.user_id`. The new model is enforced across an OAuth flow, an onboarding modal, several DB triggers, four RPCs, and a dozen RLS policies — but it is not written down anywhere a future contributor (or AI coding session) can read end-to-end. As a result the legacy `canEdit`/`OWNER_EMAIL` patterns keep getting reintroduced.

This change captures the current behavior as a spec so it becomes the canonical source of truth, prevents regressions, and gives future change proposals a baseline to diff against. No code changes — this is a documentation/spec seeding change.

## What Changes

- Introduce a new `auth-permissions` capability in `openspec/specs/` that documents:
  - The Google OAuth sign-in flow and the magic-link removal
  - The `profiles` table contract (id-mirrors-auth.uid, unique username, is_admin)
  - The `players.user_id` claim model (claimed vs unclaimed/legacy rows)
  - First sign-in onboarding (auto-username, auto-create-or-claim player)
  - Admin election (DB trigger flips `is_admin` for the original owner email)
  - The three permission tiers: **global admin**, **club admin** (via `club_admins`), **group admin** (via `group_members.is_admin`)
  - The matrix of who can read/write each table (RLS policies)
  - Admin-only operations and "cannot demote the last admin" / "cannot remove the last group admin" safety rules
- No code or schema modifications. No existing capabilities are modified (none exist yet).

## Capabilities

### New Capabilities
- `auth-permissions`: How users sign in, get a profile + player, and what each role (anonymous / signed-in user / admin) is allowed to read and write.

### Modified Capabilities
_None — this is the first spec in the repo._

## Impact

- **Code**: none.
- **Schema**: none.
- **Docs**: adds `openspec/specs/auth-permissions/spec.md` as the new canonical reference. The relevant section of `README.md` and the `project_auth_model.md` memory should eventually link to it (out of scope for this change).
- **Process**: future auth/permissions changes go through a `changes/<id>/` proposal with a delta against this spec, instead of being made directly in code.
