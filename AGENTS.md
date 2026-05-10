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
