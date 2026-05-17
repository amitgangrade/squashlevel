/**
 * Plain-English explainer for how a Boast level changes. Rendered as a
 * dismissible inline panel on the Leaderboard / Club / Group pages so
 * non-specialists understand the (P), the "stub" pill, and the
 * upset-driven movement before reading any individual row. Triggered
 * from a "How levels work" link next to the page heading + a small
 * info icon in the desktop "Level" column header.
 *
 * Kept as a shared component so future copy changes land in one place
 * — three leaderboards (overall / club / group) drift quickly if each
 * has its own explainer.
 */
export function LevelHelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <div
      id="level-help-panel"
      role="region"
      aria-label="How levels work"
      className="mb-3 rounded-md border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40"
    >
      <div className="flex items-start justify-between gap-3 px-3 sm:px-4 py-3">
        <div className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
          <p>
            <span className="font-semibold">Higher is better.</span> Everyone starts at a seed level
            (1000 by default, or your SquashLevels.com / LevelTech number if you have one). Wins
            push your level up; losses pull it down.
          </p>
          <p>
            <span className="font-semibold">Upsets move levels the most.</span> Beating a much
            stronger player gives you a big jump; beating someone weaker barely moves the needle.
            The winner and loser always shift by the <em>same proportional amount</em> in opposite
            directions.
          </p>
          <p>
            <span className="font-semibold">Match type scales the change.</span> Tournament matches
            move levels the most, then league, then box-league, then friendlies. A tournament win
            is worth about 2.3× a friendly win between the same two players.
          </p>
          <p>
            <span className="font-semibold">
              <span className="tag mr-1">P</span> Provisional
            </span>{' '}
            — a new player who hasn't entered a seed rating. Their first few matches only adjust
            their own level; established opponents are insulated so a new player can't accidentally
            drag everyone around. Once they've played enough rated matches, the (P) drops.
          </p>
          <p>
            <span className="font-semibold">
              <span className="tag mr-1">stub</span> Not yet signed up
            </span>{' '}
            — someone added them so a match could be logged against them, but they haven't claimed
            their account on Boast yet. When they sign in with the matching email, the player and
            all their match history transfer to them.
          </p>
          <p className="text-xs text-slate-500">
            The "live" level you see is computed from every confirmed match in chronological order,
            so it's always derivable from history — no fudge factors, no decay.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 -mr-1 -mt-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-xl leading-none px-2"
        >
          ×
        </button>
      </div>
    </div>
  )
}
