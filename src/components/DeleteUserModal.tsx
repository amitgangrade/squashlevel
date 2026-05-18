import { useEffect, useState } from 'react'
import { Alert } from './Alert'

export interface DeleteUserModalProps {
  open: boolean
  onClose: () => void
  /** Called with the chosen mode. The parent owns the async work and is
   *  expected to close the modal on success. */
  onConfirm: (mode: 'soft' | 'hard') => void | Promise<void>
  displayName: string
  email?: string
  /** When true the user has a sign-in account (claimed player); both soft
   *  and hard options are shown. When false there is no auth/profile to
   *  detach from — only hard delete applies and the modal collapses to a
   *  single confirm matching the legacy Roster wording. */
  isClaimed: boolean
  /** Set true while the parent's async work is in flight; disables buttons. */
  busy?: boolean
  /** Optional error from the parent's async work; rendered inline. */
  error?: string | null
  /** Optional extra context shown on the unclaimed-only confirm — e.g.,
   *  "N matches will be removed too". Ignored when isClaimed is true. */
  unclaimedExtra?: string
}

/**
 * Admin-only modal for deleting a user/player. Per
 * openspec/specs/auth-permissions/spec.md → "Player RLS":
 *
 *   • Soft delete (default for claimed): drops auth + profile only; the
 *     player row stays as unclaimed, history preserved, reclaimable by the
 *     same email later.
 *   • Hard delete (claimed): full cascade — auth, profile, player, every
 *     match, challenge, and group membership. Opponents' levels go stale
 *     until "Rebuild levels" runs. Requires a second click-through.
 *   • Unclaimed players: only the single hard path applies.
 */
export function DeleteUserModal({
  open,
  onClose,
  onConfirm,
  displayName,
  email,
  isClaimed,
  busy = false,
  error = null,
  unclaimedExtra,
}: DeleteUserModalProps) {
  // Two-step state for hard-delete on claimed players: first the choice
  // screen, then an explicit "are you really sure" confirmation. Reset on
  // every open so re-opening the modal doesn't surface a stale state.
  const [hardConfirm, setHardConfirm] = useState(false)

  useEffect(() => {
    if (!open) setHardConfirm(false)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open) return null

  const subject = email ? `${displayName} (${email})` : displayName

  return (
    <div
      className="fixed inset-0 z-50 bg-white dark:bg-slate-950 sm:bg-slate-950/60 sm:dark:bg-slate-950/80 sm:grid sm:place-items-center sm:p-4 overflow-hidden"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-user-modal-title"
    >
      <div className="flex h-full sm:h-auto sm:max-h-[90vh] w-full sm:max-w-lg flex-col bg-white dark:bg-slate-950 sm:rounded-lg sm:border sm:border-slate-200 sm:dark:border-slate-800 sm:shadow-2xl">
        <div className="px-4 sm:px-6 pt-4 sm:pt-6 pt-safe shrink-0 flex items-start justify-between gap-3">
          <h2 id="delete-user-modal-title" className="text-xl sm:text-lg font-semibold">
            Delete {displayName}
          </h2>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-xl leading-none px-2"
            onClick={onClose}
            aria-label="Close"
            disabled={busy}
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
          {!isClaimed ? (
            <UnclaimedConfirm subject={subject} extra={unclaimedExtra} />
          ) : hardConfirm ? (
            <HardConfirm subject={subject} />
          ) : (
            <ChoicePanel subject={subject} />
          )}

          {error && <Alert variant="error">{error}</Alert>}
        </div>

        <div className="shrink-0 border-t border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-3 flex flex-wrap gap-2 justify-end">
          {!isClaimed ? (
            <>
              <button
                type="button"
                className="btn-secondary"
                onClick={onClose}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={() => onConfirm('hard')}
                disabled={busy}
              >
                {busy ? 'Deleting…' : 'Delete player'}
              </button>
            </>
          ) : hardConfirm ? (
            <>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setHardConfirm(false)}
                disabled={busy}
              >
                Back
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={() => onConfirm('hard')}
                disabled={busy}
              >
                {busy ? 'Deleting…' : 'Confirm hard delete'}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn-secondary"
                onClick={onClose}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-link-danger"
                onClick={() => setHardConfirm(true)}
                disabled={busy}
              >
                Hard delete…
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => onConfirm('soft')}
                disabled={busy}
              >
                {busy ? 'Deleting…' : 'Delete account, keep matches'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ChoicePanel({ subject }: { subject: string }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Choose how to delete <strong>{subject}</strong>:
      </p>

      <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-1">
        <div className="font-medium text-sm">Delete account, keep matches <span className="text-xs font-normal text-emerald-700 dark:text-emerald-400">(recommended)</span></div>
        <p className="text-xs text-slate-500">
          Removes their sign-in and profile. Their player record stays as
          unclaimed, with name and history intact, so they can sign back in
          later with the same email and reclaim it. Opponents' levels are
          unaffected.
        </p>
      </div>

      <div className="rounded-lg border border-red-200 dark:border-red-900/60 p-3 space-y-1">
        <div className="font-medium text-sm text-red-700 dark:text-red-300">Hard delete</div>
        <p className="text-xs text-slate-500">
          Also deletes every match, challenge, and group membership they were
          part of. Opponents' levels will be stale until you run "Rebuild
          levels". Reserved for spam accounts or duplicate-profile cleanup.
          This cannot be undone.
        </p>
      </div>
    </div>
  )
}

function HardConfirm({ subject }: { subject: string }) {
  return (
    <div className="space-y-3">
      <Alert variant="warn">
        <div className="space-y-1">
          <div className="font-semibold">Hard delete is permanent.</div>
          <div className="text-xs">
            This removes <strong>{subject}</strong>'s account, profile, player
            record, and every match, group membership, and challenge they were
            part of. Levels for opponents will be stale until you run "Rebuild
            levels". This cannot be undone.
          </div>
        </div>
      </Alert>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Click <strong>Confirm hard delete</strong> below to proceed, or go back
        to choose the soft option instead.
      </p>
    </div>
  )
}

function UnclaimedConfirm({ subject, extra }: { subject: string; extra?: string }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Delete <strong>{subject}</strong>?
      </p>
      {extra && <p className="text-xs text-slate-500">{extra}</p>}
      <p className="text-xs text-slate-500">
        This player has no sign-in account. Deleting the player row will also
        remove every match, challenge, and group membership they were in.
      </p>
    </div>
  )
}
