## Why

The auth/permissions surface is now spec'd (`add-auth-permissions-spec`), but the rest of the project — match recording, the rating algorithm, player claiming, clubs, groups, and challenges — still lives only in code, schema comments, and contributor memory. This is the domain logic that's most dangerous to regress: the rating math defines the product, the match-confirmation state machine determines whether games count, and the claim flow is the one place where users' historical data can quietly disappear.

This change seeds canonical specs for those six capabilities so they exist in `openspec/specs/` as a baseline. No code changes; this is a documentation pass that captures behavior already implemented in `supabase/schema.sql` and `src/`.

## What Changes

- Add six new capabilities, each documenting requirements + scenarios that mirror current behavior:
  - `match-recording` — match shape, the pending → confirmed/disputed lifecycle, auto-confirm rules, the unranked flag, the 3-day aging job.
  - `rating` — the SquashLevel-style algorithm: expected vs actual performance, points/games sigmoid blend, damping, match-type weight, provisional players, full recomputation.
  - `player-claim` — how a `players` row links to a user (via `user_id`), email-normalized auto-claim at first sign-in, explicit claim by id, unclaimed-player creation by participants.
  - `clubs` — the curated `clubs` registry, the derived "club via `players.club`" view, name slugging, summary rollups, registry merge.
  - `groups` — ad-hoc rosters with public/private visibility, membership, group admins, last-admin safety.
  - `challenges` — challenge state machine (`pending → accepted | declined | cancelled | expired`), who can transition each edge, duplicate-prevention rule.
- No schema, RPC, RLS, or client logic changes.
- Permission-related rules are referenced from but NOT duplicated into these specs — the `auth-permissions` spec remains the single source of truth for who-can-do-what across tables.

## Capabilities

### New Capabilities
- `match-recording`: match data model, recording flow, confirmation lifecycle.
- `rating`: the level-update algorithm and full recomputation semantics.
- `player-claim`: how users link to a single ranked player row, including legacy/unclaimed flows.
- `clubs`: the curated club registry + derived player-club view, slugging, summaries.
- `groups`: ad-hoc rosters with admins and visibility rules.
- `challenges`: the challenge state machine and its RPCs.

### Modified Capabilities
_None._

## Impact

- **Code/schema**: none.
- **Docs**: adds six new spec files under `openspec/specs/` upon archive. Future changes that touch these areas must include spec deltas.
- **Process**: along with the auth-permissions spec, this seeds the project's full spec baseline. The next non-trivial change should be the first real proposal-driven change.
