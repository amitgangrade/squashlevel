import { useEffect, useState } from 'react'
import { Pagination } from '../components/Pagination'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { useStore } from '../state/store'
import { MATCH_STATUS_LABEL, type Player, type Match } from '../types'
import { MatchCard } from '../components/MatchCard'
import { PlayerSearch } from '../components/PlayerSearch'
import { EditMatchDialog } from '../components/EditMatchDialog'

export function HistoryPage() {
  const { players, recomputed, settings, isAdmin, removeMatch, confirmMatch, session, myPlayer, fetchMatchesPage } = useStore()
  const [filterPlayer, setFilterPlayer] = useState<Player | null>(null)
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 100
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [editing, setEditing] = useState<Match | null>(null)
  const [rebuildHint, setRebuildHint] = useState(false)

  const [visibleRows, setVisibleRows] = useState<Match[]>([])
  const [totalRows, setTotalRows] = useState(0)

  useEffect(() => {
    fetchMatchesPage(page, PAGE_SIZE, filterPlayer?.id).then(({ data, count }) => {
      // Merge enriched (recomputed) data for confirmed matches if available
      const enrichedById = new Map(recomputed.matches.map((m) => [m.id, m] as const))
      setVisibleRows(data.map(m => enrichedById.get(m.id) ?? m))
      setTotalRows(count)
    }).catch(console.error)
  }, [page, filterPlayer, fetchMatchesPage, recomputed.matches])

  const remove = async (id: string) => {
    if (!window.confirm('Delete this match? Levels will be recomputed from history.')) return
    setErr(null)
    try {
      await removeMatch(id)
      setVisibleRows((prev) => prev.filter((m) => m.id !== id))
      setTotalRows((n) => Math.max(0, n - 1))
      setRebuildHint(true)
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  const act = async (id: string, dispute: boolean) => {
    setErr(null)
    setBusy(id + (dispute ? ':d' : ':c'))
    try {
      await confirmMatch(id, dispute)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <h1>
          Match history{' '}
          <span className="text-base font-normal text-slate-500">
            ({totalRows.toLocaleString()}{filterPlayer ? ` for ${filterPlayer.name}` : ''})
          </span>
        </h1>
        <div className="w-full sm:w-72">
          <PlayerSearch
            value={filterPlayer}
            onChange={(p) => { setFilterPlayer(p); setPage(0) }}
            placeholder="Filter by player…"
          />
        </div>
      </div>

      {err && <div className="text-sm text-red-600">{err}</div>}

      {rebuildHint && (
        <div className="card border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-100 flex items-start justify-between gap-3">
          <div className="text-sm">
            <strong>Match history changed.</strong> Player levels are now stale — run{' '}
            <Link to="/admin" className="underline font-medium">Admin → Rebuild levels</Link>{' '}
            to recompute.
          </div>
          <button
            className="text-amber-700 hover:text-amber-900 dark:text-amber-200 text-lg leading-none px-1"
            onClick={() => setRebuildHint(false)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      <Pagination page={page} pageSize={PAGE_SIZE} total={totalRows} onPage={setPage} />

      {visibleRows.length === 0 ? (
        <div className="card text-center text-slate-500">No matches found.</div>
      ) : (
        <div className="space-y-2">
          {visibleRows.map((m) => {
            const status = m.status ?? 'confirmed'
            const isMyPending =
              status === 'pending' &&
              !!session?.user &&
              !!myPlayer &&
              (m.playerAId === myPlayer.id || m.playerBId === myPlayer.id) &&
              m.createdBy !== session.user.id
            const isMyRecorded =
              status === 'pending' && session?.user?.id === m.createdBy
            const ring =
              status === 'pending' ? 'amber'
              : status === 'disputed' ? 'tin'
              : 'none'

            const actions: React.ReactNode[] = []
            if (isMyPending) {
              actions.push(
                <button
                  key="confirm"
                  className="btn-primary"
                  onClick={() => act(m.id, false)}
                  disabled={busy !== null}
                >
                  {busy === m.id + ':c' ? 'Confirming…' : 'Confirm'}
                </button>,
                <button
                  key="dispute"
                  className="btn bg-tin-100 text-tin-700 hover:bg-tin-200 dark:bg-tin-900/30 dark:text-tin-200"
                  onClick={() => act(m.id, true)}
                  disabled={busy !== null}
                >
                  {busy === m.id + ':d' ? 'Reporting…' : 'Dispute'}
                </button>,
              )
            }
            if (isAdmin) {
              actions.push(
                <button
                  key="edit"
                  className="btn-link ml-auto"
                  onClick={() => setEditing(m)}
                >
                  Edit
                </button>,
                <button
                  key="delete"
                  className="btn-link-danger"
                  onClick={() => remove(m.id)}
                >
                  Delete
                </button>,
              )
            }

            const hint = isMyRecorded
              ? <>Waiting on your opponent. <Link to="/activity" className="underline">View →</Link></>
              : null

            return (
              <MatchCard
                key={m.id}
                match={m}
                players={players}
                settings={settings}
                viewerId={myPlayer?.id}
                ring={ring}
                statusBadge={<StatusBadge status={status} autoConfirmed={!!m.autoConfirmed} />}
                hint={hint}
                actions={actions.length > 0 ? <>{actions}</> : null}
              />
            )
          })}
        </div>
      )}
      {totalRows > 0 && (
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={totalRows}
          onPage={setPage}
          noun="matches"
        />
      )}

      {editing && (
        <EditMatchDialog
          match={editing}
          players={players}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setVisibleRows((prev) => prev.map((x) => (x.id === saved.id ? saved : x)))
            setRebuildHint(true)
          }}
        />
      )}
    </div>
  )
}

function StatusBadge({ status, autoConfirmed }: { status: 'pending' | 'confirmed' | 'disputed'; autoConfirmed: boolean }) {
  if (status === 'confirmed' && !autoConfirmed) return null
  if (status === 'confirmed' && autoConfirmed) {
    return (
      <span className="ml-auto rounded-full bg-slate-100 text-slate-600 text-[10px] font-semibold px-2 py-0.5 dark:bg-slate-800 dark:text-slate-300" title="Auto-confirmed (recorder reported a self-loss, or 3-day timeout passed)">
        auto-confirmed
      </span>
    )
  }
  return (
    <span className={clsx(
      'ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
      status === 'pending' && 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
      status === 'disputed' && 'bg-tin-100 text-tin-800 dark:bg-tin-900/40 dark:text-tin-200',
    )}>
      {MATCH_STATUS_LABEL[status]}
    </span>
  )
}
