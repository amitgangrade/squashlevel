import clsx from 'clsx'

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} />
}

export function SkeletonRow() {
  return (
    <div className="card flex items-center gap-3 py-3">
      <Skeleton className="h-6 w-6" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3 w-1/3" />
      </div>
      <Skeleton className="h-7 w-16" />
    </div>
  )
}

/**
 * Match-card sized skeleton — used while a profile/club/group page fetches
 * its match list. Roughly mirrors the height of a real MatchCard so layout
 * doesn't jump on hydration.
 */
export function SkeletonMatchCard() {
  return (
    <div className="card space-y-2 py-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-3 w-16" />
      </div>
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
        <Skeleton className="h-6 w-12" />
      </div>
    </div>
  )
}

/**
 * Compact table-row skeleton for the leaderboard tables on club / group pages.
 */
export function SkeletonTableRow() {
  return (
    <tr className="border-t border-slate-100 dark:border-slate-800">
      <td className="px-3 py-2"><Skeleton className="h-4 w-4" /></td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-3">
          <Skeleton className="h-7 w-7 rounded-full" />
          <Skeleton className="h-4 w-32" />
        </div>
      </td>
      <td className="px-3 py-2 text-right"><Skeleton className="ml-auto h-4 w-10" /></td>
      <td className="px-3 py-2 text-right hidden sm:table-cell"><Skeleton className="ml-auto h-4 w-10" /></td>
      <td className="px-3 py-2 text-right"><Skeleton className="ml-auto h-4 w-8" /></td>
    </tr>
  )
}
