# Boast

> **Squash ratings for every player. Free forever.**

Boast is a free, global squash rating platform. Sign in with Google, log every match you play, and watch your level update against everyone else playing squash on the platform — anywhere in the world.

- **Free forever, full stop.** No ads. No paywall. No "pro" tier.
- **One-click Google sign-in.** Onboard in under a minute.
- **Real-time ratings.** A SquashLevels-style algorithm updates everyone's level the moment a match is logged.
- **Mobile-first PWA.** Add to home screen on iOS / Android for an app-like experience.

---

## Features

### Players
- Google sign-in. New users complete a one-step profile (full name, optional photo, country, city, club, year of birth, gender, dominant hand, starting rating).
- Auto-generated `@username` from your name (collisions handled with a numeric suffix).
- Public profile with avatar, level, match count, and stats.
- Edit your profile any time.

### Matches
- Anyone signed in can log a match they played in. Pick your opponent from a typeahead search that scales to tens of thousands of players (server-side `ilike` with a trigram index).
- Game-by-game scores with a live preview of the level deltas before you save.
- Match types are weighted: friendly < box league < league < tournament.
- Match-saved emails (optional, via Resend) to both players.

### Ratings
- Pure-TypeScript implementation of the [SquashLevels](https://squashlevels.com) / [LevelTech](https://leveltech.io) rating model. Unit-tested.
- Provisional players (<5 matches) only move their own level; their opponent stays put. Their `(P)` flag is shown across the app.
- Tournament > league > box > friendly weight multipliers.
- 4-match moving average displayed alongside the dynamic level for stability.
- Admin can tune the constants (damping, exponents, provisional threshold) from `/settings`; a full recompute runs automatically.

### Admin
- The first user with the configured admin email is auto-promoted via a Postgres trigger.
- Admins can: add/edit/delete any player, claim un-owned legacy player rows, edit/delete any match, change algorithm settings, run a full data wipe.
- Player rows pre-created by an admin can be **claimed** by the user when they sign in (case-insensitive email match, with Gmail dot/+ normalization). All matches already attributed to that legacy row are preserved.

### Mobile UX
- Bottom tab bar (Home · Players · History · More) on phones.
- Floating "Log match" FAB.
- Pull-to-refresh on the dashboard.
- Full-screen onboarding sheet, full-screen opponent search.
- Safe-area aware (iPhone notch / home indicator).
- iOS "Add to Home Screen" hint banner (dismissible, 30-day re-prompt).
- Skeleton loaders, haptic feedback on match save.

### Algorithm transparency

| Concept | Implementation |
|---|---|
| Levels are multiplicative (2× level = 2× as good) | Sigmoid `L_A^k / (L_A^k + L_B^k)` for expected ratios |
| Equal levels → 50/50 points | `pointsExponent = 2` (default) |
| 2× level → ~80% points / ~97% games | `pointsExponent = 2`, `gamesExponent = 5` (default) |
| Points **and** games combined | Weighted blend, `pointsWeight = 0.5` |
| Damping prevents wild swings | `dampingK = 0.12` (default) |
| Tournament > league > box > friendly | Weight multiplier per match type |
| Provisional players (<5 matches) | Only their level updates, not the opponent's |
| 4-match moving average | Displayed alongside the live level |
| Symmetric updates | `ΔA = −ΔB` when neither side is provisional |

All constants are exposed in **Settings** and a full recompute runs whenever you change them.

The unit-tested algorithm core lives in [`src/lib/rating`](src/lib/rating/).

---

## Tech stack

| Layer | What |
|---|---|
| Frontend | React 19 · Vite · TypeScript · Tailwind CSS |
| State / data | React context store + Supabase realtime subscriptions |
| PWA | `vite-plugin-pwa` (Workbox) |
| Auth | Supabase Auth (Google OAuth) |
| Database | Supabase Postgres + Row Level Security |
| Storage | Supabase Storage (`avatars` bucket, public-read, owner-write) |
| Edge functions | Deno / Supabase Functions (`send-match-email` via Resend) |
| Offline fallback | IndexedDB (`idb`) — only used when Supabase env vars are absent |

---

## For contributors and AI coding assistants

- **[`ARCHITECTURE.md`](./ARCHITECTURE.md)** — how the pieces fit together and where to look first.
- **[`AGENTS.md`](./AGENTS.md)** — conventions and anti-patterns. Read before mass-editing.
- **[`openspec/specs/`](./openspec/specs/)** — capability specs for auth, matches, ratings, clubs, groups, challenges, player-claim. Use `/opsx:propose` for non-trivial changes.

---

## Quick start (local development)

```bash
npm install --legacy-peer-deps
npm run dev          # http://localhost:5173
npm test             # run unit tests
npm run build        # production build → dist/
```

Without Supabase env vars set, the app boots in **offline / local-only** mode against IndexedDB — useful for demos but no auth, no sync. To run the real product locally:

1. Create a Supabase project.
2. Open the SQL editor, paste the contents of [`supabase/schema.sql`](supabase/schema.sql), and run it. (Idempotent — safe to re-run.)
3. Enable the Google auth provider (Authentication → Providers → Google) and configure your Google Cloud OAuth client. The redirect URL is shown in the Supabase dashboard.
4. Add an `Authentication → URL Configuration` site URL and redirect URL.
5. Drop a `.env.local` in the project root:
   ```
   VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
6. `npm run dev` and sign in.

The first user whose email matches the one configured in [`supabase/schema.sql`](supabase/schema.sql) (`bootstrap_admin` trigger) is auto-promoted to admin on first sign-in. Edit that email to make yourself the admin if you're forking.

---

## Deploying

### Static hosting (the frontend)

The frontend is a static SPA — host the `dist/` build anywhere.

**GitHub Pages**: see [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). Set `VITE_BASE=/your-repo-name/`, enable Pages → Source: GitHub Actions.

**Netlify / Vercel / Cloudflare Pages**: standard Vite SPA config, no special setup.

### Edge function

Optional. To send "match logged" emails:

```bash
supabase functions deploy send-match-email
supabase secrets set RESEND_API_KEY=re_...
supabase secrets set EMAIL_FROM='Boast <updates@yourdomain.com>'
supabase secrets set SITE_URL='https://your-deployed-site/'
```

### Storage bucket

The `avatars` bucket and its RLS policies are created by `supabase/schema.sql`. Nothing extra to configure.

### Keeping the free Supabase project awake

Free-tier projects pause after ~7 days of low activity. Two independent pingers prevent that:

1. **GitHub Actions** — [`.github/workflows/keepalive.yml`](.github/workflows/keepalive.yml) calls the `public.ping()` RPC daily, using the same `SUPABASE_URL` / `SUPABASE_ANON_KEY` repo secrets as the deploy. It also re-enables itself each run so GitHub's 60-day inactivity rule never switches it off. A failed run emails you.
2. **External cron (recommended backup)** — on [cron-job.org](https://cron-job.org) (free), create a daily job:
   - URL: `https://YOUR-PROJECT.supabase.co/rest/v1/rpc/ping`
   - Method `POST`, body `{}`
   - Headers: `apikey: <anon key>`, `Content-Type: application/json`
   - Turn on failure notifications.

Test by hand:

```bash
curl -X POST "https://YOUR-PROJECT.supabase.co/rest/v1/rpc/ping" -H "apikey: <anon key>" -H "Content-Type: application/json" -d '{}'
```

A timestamp in the response means it works.

---

## Data model

| Table | Notes |
|---|---|
| `profiles` | One row per signed-in user. `id` references `auth.users`. Holds full name, `@username`, email, phone, country, city, club, year of birth, gender, dominant hand, avatar URL, starting level, `is_admin`. |
| `players` | Ranked entities. `user_id` (nullable, unique) links a player row to an auth user. Legacy rows with `user_id IS NULL` can be claimed by the user matching the email at first sign-in. |
| `matches` | `player_a_id`, `player_b_id`, date, type, `games jsonb`, optional notes. RLS: insert allowed if you own one of the two players or you're admin; update/delete is admin-only. |
| `settings` | Single `app` row holding algorithm constants. Admin-only writes. |

Helper functions:
- `is_admin(uid)` — convenience used in policies.
- `bootstrap_admin()` — trigger that auto-flips `is_admin` for the configured owner email on first profile insert.
- `norm_email(text)` — lowercases + handles Gmail dot / `+` normalization.
- `claim_player_for_me()` — `SECURITY DEFINER` RPC called during onboarding to claim a pre-existing un-owned player matching the user's email.

Full schema (idempotent, includes all RLS policies, triggers, indexes, storage bucket): [`supabase/schema.sql`](supabase/schema.sql).

---

## Roadmap

Things on the runway, ordered by likely impact:

- **Match confirmation** — opponent must accept the result before it counts (prevents accidental / malicious score entry at scale).
- **Public profile pages** at `/u/<username>` — rating chart, recent matches, head-to-head.
- **Notifications** — email + push when someone logs a match against you, weekly digest.
- **Clubs & groups** — join a club, see club-scoped leaderboards, find local opponents.
- **Tournaments / leagues** — bracket generation with the existing tournament weight.
- **Server-side rating** — port the rating algorithm to a Postgres trigger or Deno edge function so the client doesn't need to download every match. Required for true 10k+ user scale.
- **Public read-only API** + embeddable rating badge.
- **Achievements / streaks** — light gamification.

If you want to help with any of the above, open an issue or PR — see "Contributing".

---

## Contributing

Contributions welcome. Boast is and will remain free and open.

```bash
git clone <this repo>
cd <repo>
npm install --legacy-peer-deps
npm run dev
npm test
```

Conventions:
- TypeScript strict; keep ESLint error count from rising (`npm run lint`).
- Co-locate component-specific files; shared utilities live in `src/lib/`.
- The rating algorithm has unit tests — please keep them green and add tests for behavior you change.
- Reuse the existing helpers — `filterByTokens`, `parseProfileFields`, `<ProvisionalTag>`, `<OrgAvatar>`, `<PlayerAvatar>`, `<MatchCard>`, `fmtLevel`/`fmtDelta`/`fmtDate` — instead of re-rolling them. See [`AGENTS.md`](./AGENTS.md) for the full list.
- DB writes that touch the rating math must update **both** `src/lib/rating/update.ts` **and** the matching plpgsql function in `supabase/schema.sql`.

---

## Credits

Algorithm modeled on the [SquashLevels](https://squashlevels.com) / [LevelTech](https://leveltech.io) public docs:

- [What are Levels?](https://support.leveltech.io/hc/en-us/articles/7712755302301-What-are-Levels)
- [How are Levels calculated?](https://support.leveltech.io/hc/en-us/articles/7712760245405-How-are-Levels-calculated)
- [Why do I have a (P)?](https://support.squashlevels.com/hc/en-us/articles/7712749647645-Why-do-I-have-a-P-against-my-Level)
- [I won my match but my Level went down](https://support.squashlevels.com/hc/en-us/articles/7712789661597-I-won-my-match-but-my-Level-went-down-How-did-that-happen)
- [The SquashLevels Algorithm (blog)](https://blog.squashlevels.com/the-squashlevels-algorithm/)

Boast is an independent project and is not affiliated with SquashLevels.
