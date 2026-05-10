## Context

This change is documentation-only: it captures the auth/permissions model that already exists in code (Google OAuth + `profiles.is_admin` + `players.user_id` claims, enforced by RLS policies and DB triggers in `supabase/schema.sql`). There is no new architecture being designed; the design notes here cover the choices made during the 2026-05-08 rebuild so future contributors understand the *why* behind the rules now being frozen as a spec.

## Goals / Non-Goals

**Goals:**
- Make the current auth model legible end-to-end in one document.
- Establish `auth-permissions` as a capability so future changes can be expressed as deltas against it.
- Give AI coding sessions a single file to read instead of stitching together memories, README fragments, and 1,600 lines of schema SQL.

**Non-Goals:**
- Changing any policy, trigger, or RPC behavior.
- Documenting non-auth capabilities (rating math, match flows, lazy loading) — those will be separate spec-seeding changes.
- Replacing the `OWNER_EMAIL` export. It stays for the UI hint; only its use as an authorization gate is forbidden.

## Decisions

**Spec one capability, not many.** The auth-permissions surface (sign-in, profiles, player claims, RLS, admin RPCs) is one coherent contract — splitting it into `auth`, `profiles`, `players`, `rls` would fragment requirements that always change together. Bundling matches how the SQL is actually organized.

**Capture behavior, not implementation.** Each requirement names *what* must hold (e.g. "non-admin cannot insert a match they didn't play in") without dictating *how* it's enforced (RLS policy vs trigger vs RPC). This lets future changes refactor enforcement (e.g. consolidating a trigger into an RPC) without a spec rewrite, as long as the externally observable rule still holds.

**Use SHALL/MUST consistently.** OpenSpec's archive validation is strict about scenario format (`#### Scenario:` with WHEN/THEN). Using normative language up front avoids weaker phrasing creeping in via later deltas.

**Keep this change to seeding only.** Tempting to also fix small inconsistencies (e.g. the legacy `owner write players` policy comment in schema.sql, or moving `OWNER_EMAIL` to a clearer location). Out of scope — bundling cleanups would muddy what is otherwise a pure documentation change. Those go in a follow-up `cleanup-legacy-auth-references` change.

## Risks / Trade-offs

- **[Risk] Spec drifts from code as policies evolve.** → Mitigation: future auth-touching PRs must include a spec delta in `openspec/changes/<id>/specs/auth-permissions/`. The `/opsx:propose` slash command makes this the default path.
- **[Risk] Over-specification freezes implementation choices.** → Mitigation: requirements name observable behavior, not enforcement mechanism, so we can refactor RLS↔trigger↔RPC freely.
- **[Risk] Owner-email special case feels hacky in writing.** → Acknowledged. The trigger is the simplest bootstrap-admin solution for a single-tenant deployment; documenting it surfaces the choice for revisit if/when we move to a true multi-tenant model.

## Migration Plan

None. No code or schema changes. Merging this change archives the spec into `openspec/specs/auth-permissions/spec.md` and the change folder moves to `openspec/changes/archive/`.

## Open Questions

- Should `OWNER_EMAIL` move out of `client.ts` (it's auth-adjacent but not an authorization gate)? Defer to a follow-up cleanup change.
- Do we want a separate `onboarding` capability for the OnboardingModal flow, or keep it folded into `auth-permissions`? Currently folded — revisit if onboarding gains more steps (e.g. payment, club selection).
