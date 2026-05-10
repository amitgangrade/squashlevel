## 1. Verify each spec matches reality

- [ ] 1.1 `match-recording`: re-read `supabase/schema.sql` (the `matches` table, `matches_before_insert`, `confirm_match`, `auto_confirm_aged_matches`, RLS policies on `matches`) and confirm every requirement still holds
- [ ] 1.2 `rating`: re-read `src/lib/rating/levels.ts`, `src/lib/rating/update.ts`, `src/lib/rating/recompute.ts` and `src/types.ts` (`SettingsSchema`, `MATCH_TYPE_WEIGHT`, `DEFAULT_SETTINGS`); confirm formulas, defaults, and provisional behavior match
- [ ] 1.3 `player-claim`: re-read the `ensure_player_for_profile`, `sync_player_from_profile`, `claim_player_for_me`, `claim_player_by_id`, `create_unclaimed_player`, `norm_email` functions; confirm spec semantics
- [ ] 1.4 `clubs`: re-read `src/lib/supabase/clubs.ts` (`clubSlug`, `summarizeClubs`, `mergeClubs`) and the SQL `club_slug`, `clubs` table, `create_club`/`delete_club` RPCs; confirm slug parity between TS and SQL
- [ ] 1.5 `groups`: re-read the `groups` and `group_members` tables, `is_group_admin`, `is_group_member`, `create_group`/`update_group`/`delete_group`, `add_group_member`/`remove_group_member` RPCs and their RLS policies
- [ ] 1.6 `challenges`: re-read the `challenges` table, `create_challenge` and `respond_to_challenge` RPCs, the `owner cancel challenge` RLS policy, and `src/lib/supabase/challenges.ts`

## 2. Validate the OpenSpec artifacts

- [ ] 2.1 Run `npx @fission-ai/openspec@latest validate seed-domain-specs` and resolve any structural errors
- [ ] 2.2 Run `npx @fission-ai/openspec@latest status --change seed-domain-specs` and confirm `isComplete: true`

## 3. Archive both seeding changes (in order)

- [ ] 3.1 Run `npx @fission-ai/openspec@latest archive add-auth-permissions-spec` (the auth spec is referenced by the others, so it's archived first)
- [ ] 3.2 Run `npx @fission-ai/openspec@latest archive seed-domain-specs`
- [ ] 3.3 Confirm `openspec/specs/` now contains: `auth-permissions/`, `match-recording/`, `rating/`, `player-claim/`, `clubs/`, `groups/`, `challenges/`
- [ ] 3.4 Commit with message `docs(openspec): seed full project spec baseline`

## 4. Discoverability

- [ ] 4.1 Add a one-line pointer in `README.md` (under a new "Specs" section) listing the seven capabilities
- [ ] 4.2 Update `memory/project_auth_model.md` to add: "Canonical spec: openspec/specs/auth-permissions/spec.md"
