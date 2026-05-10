## Context

The `add-auth-permissions-spec` change captured the auth/permissions surface. This change captures the remaining domain logic. Like the auth change, this is documentation-only — every requirement here corresponds to behavior already shipped in `supabase/schema.sql`, `src/lib/rating/`, and `src/lib/supabase/`.

Six capabilities are being seeded in one change rather than six separate changes because (a) they're a coherent baseline and reviewing them together gives a holistic picture of the project, (b) splitting would force redundant proposal/design boilerplate for a pure documentation pass, and (c) future modifications to any one capability will go through their own focused proposals.

## Goals / Non-Goals

**Goals:**
- Capture the rating algorithm in writing so a future contributor can reason about it without having to read `levels.ts` and `update.ts` line by line.
- Pin down the match-confirmation state machine (auto-confirm rules, 3-day aging, who can transition each edge) so the next "tweak when matches confirm" change has a baseline to diff against.
- Document the player-claim flow end-to-end since it's the one place users' historical match data can be lost or duplicated if logic regresses.
- Make clubs/groups/challenges legible — these are smaller features but each has its own state and permission rules.

**Non-Goals:**
- Re-specifying the auth/permissions matrix. The `auth-permissions` capability remains the canonical source for who-can-do-what. Where these specs touch permissions, they say "see auth-permissions" rather than restate.
- Locking down implementation details. Requirements describe observable behavior; enforcement (RLS vs trigger vs RPC) is left flexible so future refactors don't need spec rewrites.
- Specifying the UI. Component-level rendering decisions (how a leaderboard sorts ties, what a pending-match badge looks like) belong in a future `ui` capability if we ever spec them at all.

## Decisions

**Bundle into one change.** Six separate changes would each duplicate proposal/design/tasks scaffolding for what is essentially one task: write down what already exists. After this change is archived, future modifications get their own focused proposals (which is the normal workflow).

**Cross-reference, don't duplicate, permissions.** Every capability except `rating` interacts with the auth model. Restating who-can-do-what in each spec would create six places to update when a permission rule changes. Specs cite `auth-permissions` for the matrix and only describe their domain-specific concerns (state transitions, validation, math).

**Ship the rating math as-is, even though some constants feel arbitrary.** The defaults (`dampingK = 0.12`, exponents 2 and 5, `pointsWeight = 0.5`) were tuned empirically. The spec captures them as the current contract; a future tuning change would propose modifications via the normal flow.

**Capture the unranked flag explicitly.** It's easy to overlook, has zero-impact behavior in the rating recompute, and is the kind of subtle invariant that gets accidentally regressed.

**Do not spec storage/avatars or realtime.** The avatars-bucket RLS is small and orthogonal to the domain; it can be added later if it grows. The realtime publication setup is infrastructure plumbing, not behavior.

## Risks / Trade-offs

- **[Risk] Six specs in one change is a lot to review.** → Mitigation: each spec stands alone; reviewer can read in any order. Future modifications never bundle six capabilities — this is a one-shot seed.
- **[Risk] The rating spec will need updates if the algorithm is tuned.** → Acknowledged. The algorithm is captured precisely so any future tuning produces a meaningful spec delta rather than a silent code change.
- **[Risk] Some specs assume the auth-permissions spec is also archived.** → Acknowledged. Archive `add-auth-permissions-spec` first, then this one.

## Migration Plan

None. No code or schema changes. On archive, six new spec folders appear under `openspec/specs/`.

## Open Questions

- Should match-recording and player-claim be merged? They're closely coupled (you can't insert a match without a claimed-or-unclaimed player). Kept separate because the lifecycle vs identity concerns are distinct enough to warrant their own changes later.
- Avatar/storage and realtime are unspecified. Worth covering eventually; not blocking now.
