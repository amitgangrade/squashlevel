# Boast — Architecture

A pragmatic map of how the codebase fits together. Read this once before
making changes; come back when you're not sure where a behaviour lives.

```
┌────────────────────────────────────────────────────────────────────────┐
│                         Browser (Vite SPA)                             │
│                                                                        │
│   pages/         ←  user-facing screens (one file per route)           │
│   components/    ←  cross-page UI                                      │
│   state/store    ←  single React context, exposes everything via hook  │
│   lib/                                                                 │
│   ├─ rating/     ←  pure functions; mirrored in plpgsql server-side    │
│   ├─ storage/    ←  backend abstraction (cloud vs local)               │
│   ├─ supabase/   ←  table mappers + RPC wrappers                       │
│   ├─ format.ts   ←  one source for level / date / initials formatters  │
│   ├─ search.ts   ←  shared token-filter helper                         │
│   ├─ places.ts   ←  country/city normalisation                         │
│   └─ profile-validation.ts                                             │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
                              │
                              │  supabase-js
                              ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       Supabase (Postgres + Auth)                       │
│                                                                        │
│   profiles, players, matches, settings,                                │
│   challenges, clubs, club_admins, groups, group_members                │
│                                                                        │
│   + RLS policies   + triggers (matches → players levels)               │
│   + RPCs (claim_player, create_challenge, rebuild_levels_*, …)         │
│                                                                        │
│   schema.sql is the canonical source. supabase/migrations/ are deltas. │
│                                                                        │
│   Edge functions:                                                      │
│   ├─ send-match-email   (Resend transactional mail)                    │
│   └─ share              (OG-tag preview redirect)                      │
└────────────────────────────────────────────────────────────────────────┘
```

## Data flow

1. **Read.** The `StoreProvider` (`src/state/store.tsx`) calls
   `backend.getAll()` once on mount and again whenever Supabase Realtime
   fires (debounced 600 ms). Cloud mode lazy-loads matches per page.
2. **Compute.** `recomputeAll(players, matches, settings)` re-derives every
   player's level and per-match enrichment in one pass. The result is
   memoised on `(players, ratedMatches, settings)`. **Only used in local
   mode** — at cloud scale we trust the server triggers and only enrich
   the visible page of matches when needed.
3. **Mutate.** All writes go through the store
   (`addMatch`, `updatePlayer`, …) → `backend.put*` → Supabase. The
   server-side trigger updates `players.current_level` and
   `players.matches_played` synchronously.
4. **Reconcile.** Realtime subscription on `players` / `matches` /
   `settings` triggers a debounced `refresh()` so other tabs/devices catch
   up.

## Key invariants

- **Rating math has two implementations** — TS (`src/lib/rating/update.ts`)
  and plpgsql (`compute_level_update` in `supabase/schema.sql`). They MUST
  stay in sync; the server uses plpgsql for the chunked rebuild RPC.
- **Player IDs are immutable.** `EditMatchDialog` never lets you change
  player A or B — would corrupt the rating-history graph.
- **The `is_admin` flag lives on `profiles`.** Server-side RLS gates every
  write; the client just hides UI early. `OWNER_EMAIL` is gone — the DB
  trigger flips `is_admin=true` for the configured bootstrap email.
- **Local mode** (no Supabase env vars) uses IndexedDB. Auxiliary tables
  (clubs, groups, challenges, club_admins) are stubs — local mode is for
  demos, not for clubs/groups workflows.

## Where things live

| If you want to... | Edit... |
| --- | --- |
| Add a new route | `src/App.tsx` (route table) + new page in `src/pages/` |
| Change leaderboard sort/filter | `src/pages/Leaderboard.tsx` |
| Tune rating formulas | `src/lib/rating/{levels,update,recompute}.ts` **and** the matching plpgsql function in `supabase/schema.sql` |
| Add a new column to `players` | `supabase/schema.sql` (idempotent ALTER), `src/types.ts`, `src/lib/supabase/mappers.ts` (both `to*Row` and `from*Row`) |
| Add a new RPC | `supabase/schema.sql` (`create or replace function`), `src/lib/supabase/<area>.ts` (typed wrapper) |
| Cross-page UI primitive | `src/components/` (e.g. `ProvisionalTag`, `OrgAvatar`, `MatchCard`) |
| Cross-page pure helper | `src/lib/` |
| Onboarding form behaviour | `src/components/OnboardingModal.tsx` + `src/lib/supabase/profile.ts` |
| Match-edit / log forms | `src/pages/LogMatch.tsx` + `src/components/EditMatchDialog.tsx` |
| Algorithm constants UI | `src/pages/Settings.tsx` |

## Conventions

- **TypeScript strict + ESLint.** `npm run lint` should not introduce new
  errors. There are a handful of pre-existing `react-hooks/*` errors in
  `src/state/store.tsx` and `vite.config.ts`; track but don't worsen.
- **No new comments unless the *why* is non-obvious.** Comments that
  describe *what* the next line does are noise; comments that describe a
  hidden constraint (e.g. "this mirrors plpgsql in schema.sql") are gold.
- **Use the helpers.** Prefer `filterByTokens`, `parseProfileFields`,
  `<ProvisionalTag>`, `<OrgAvatar>`, `<PlayerAvatar>`, `fmtLevel`,
  `fmtDelta`, `fmtDate`, `initialsFor`, `playerAge` over re-implementing.
- **Server-managed columns** (`current_level`, `matches_played`,
  `confirmed_at`, `auto_confirmed`, …) are written by triggers; client
  inserts/upserts MUST omit them so the upsert leaves them intact.
- **Cloud mode lazy-loads matches.** Pages must not assume `store.matches`
  is populated — the leaderboard reads `players.current_level`; profile /
  history pages call `fetchRecentMatches` / `fetchMatchesPage`.

## Server-side notes

- `supabase/schema.sql` is **idempotent** and is the single source of
  truth. Add new tables/columns/policies there.
- `supabase/migrations/` holds historical migration files for projects
  that already ran the schema; new changes go into both `schema.sql` and
  a dated migration file.
- `rebuild_levels_*` RPCs split the rebuild into ≤10 000-match chunks so
  no single statement hits the edge proxy timeout. The cursor lives in
  `level_rebuild_state` between chunks. The store retries transient
  errors automatically.
- `matches` has three triggers, each with a tight responsibility:
  - `matches_before_insert` — auto-confirm rules + auto-fill `created_by`.
  - `matches_validate_date` — rejects matches dated outside
    `[max(players.created_at::date), current_date]`. Grandfathers
    UPDATEs that don't change `date`.
  - `matches_after_levels` — applies the incremental level delta to
    `players.current_level` + `matches_played` on insert/update/delete.
    Correct for latest-dated inserts; not aware of reorderings.
  - `matches_after_date_reorder` — when a mutation isn't strictly the
    latest confirmed match for both participants, flags
    `players.levels_stale = true`. The admin Rebuild Levels page
    surfaces stale players as a banner; running the full rebuild
    clears the flag.

## What we deliberately don't do

- No server-side rendering, no Next.js, no app router. SPA + hash routes.
- No Redux / Zustand / Jotai. One React context, plain `useState`.
- No CSS-in-JS. Tailwind utility classes; `@layer components` for the
  shared `.btn`, `.card`, `.input`, `.tag` primitives in `src/index.css`.
- No icon library. Hand-rolled SVGs in `src/components/Icons.tsx`.
- No backwards-compat shims. We rewrite freely; the export/import flow
  is the safety net for live data.
