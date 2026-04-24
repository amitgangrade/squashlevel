# Spring Tropica Squash Group

A squash tracker for the **Spring Tropica Squash Group** in Singapore 🇸🇬. Mirrors the [SquashLevels](https://squashlevels.com) / [LevelTech](https://leveltech.io) rating methodology so numbers stay comparable with your public rating.

- Installable as a **PWA** on desktop (Chrome, Edge, Safari) and mobile (iOS "Add to Home Screen", Android "Install app").
- Data lives in **your browser's IndexedDB** — no server, no account.
- Full JSON **export / import** for backups and moving between devices.
- Host it for free on **GitHub Pages**.

## Features

- **Players** — add people, seed their starting level from SquashLevels.com.
- **Log a match** — game-by-game scores, match type (friendly / box / league / tournament), live preview of level deltas.
- **Dashboard** — ranked leaderboard with current level and 4-match moving average.
- **History** — every match with before/after levels; delete to force a recompute.
- **Analytics** — level over time, per-player stats, head-to-head.
- **Settings** — tune damping, ratio exponents, provisional threshold; export/import/reset.

## The algorithm

Pure TS, unit-tested, lives in [`src/lib/rating`](src/lib/rating/). Core ideas mirrored from the SquashLevels docs:

| Concept | Implementation |
|---|---|
| Levels are multiplicative (2× level = 2× as good) | Sigmoid `L_A^k / (L_A^k + L_B^k)` for expected ratios |
| Equal levels → 50/50 points | `k_points = 2` (default) |
| 2× level → ~80% points / ~97% games | `k_points = 2`, `k_games = 5` (default) |
| Points **and** games combined | Weighted blend, `pointsWeight = 0.5` (default) |
| Damping prevents wild swings | `dampingK = 0.12` (default) |
| Tournament > league > box > friendly | Weight multiplier per match type |
| Provisional players (<5 matches) | Only their level updates, not opponent's |
| 4-match moving average | Displayed on dashboard alongside dynamic level |
| Symmetric updates (one up, one down) | `ΔA = -ΔB` when neither is provisional |

All constants are exposed in **Settings** and a full recompute runs automatically when you change them.

## Development

```bash
npm install --legacy-peer-deps
npm run dev          # http://localhost:5173
npm test             # run unit tests
npm run build        # production build to dist/
```

## Deploying to GitHub Pages

1. Create a GitHub repo and push this project to `main`.
2. In repo **Settings → Pages**, set *Source* to **GitHub Actions**.
3. Push — the workflow at [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) builds with `VITE_BASE=/<repo-name>/` and publishes to Pages automatically.
4. Open the URL GitHub gives you and, on mobile, tap **Add to Home Screen**.

Your data never leaves your browser, so each person who installs the PWA has their own copy. Use **Settings → Export JSON** to share a canonical dataset, or one person can act as the group's "source of truth" and publish the JSON alongside the site.

## Data model

- **Players** — `{ id, name, startingLevel, createdAt, notes? }`
- **Matches** — `{ id, date, playerAId, playerBId, games: [{a, b}], type, notes?, ...levels }`
- **Settings** — tuning constants; single-row keyed `app`.

Enriched before/after level fields on matches are derived by `recomputeAll` — they're cached in IndexedDB but regenerated from scratch whenever you edit or delete anything, so the history stays internally consistent.

## Tuning against real SquashLevels numbers

If you want the app's numbers to track SquashLevels more tightly:

1. Export your SquashLevels history (pre-match levels, scores, post-match levels).
2. Log the same matches here with the same starting levels.
3. Tweak `dampingK`, `pointsExponent`, `gamesExponent` in **Settings** until the deltas match.

## Sources

Algorithm documented across LevelTech / SquashLevels support:

- [What are Levels?](https://support.leveltech.io/hc/en-us/articles/7712755302301-What-are-Levels)
- [How are Levels calculated?](https://support.leveltech.io/hc/en-us/articles/7712760245405-How-are-Levels-calculated)
- [Why do I have a (P)?](https://support.squashlevels.com/hc/en-us/articles/7712749647645-Why-do-I-have-a-P-against-my-Level)
- [I won my match but my Level went down](https://support.squashlevels.com/hc/en-us/articles/7712789661597-I-won-my-match-but-my-Level-went-down-How-did-that-happen)
- [The SquashLevels Algorithm (blog)](https://blog.squashlevels.com/the-squashlevels-algorithm/)
