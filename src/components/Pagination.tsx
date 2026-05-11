interface Props {
  page: number
  pageSize: number
  total: number
  onPage: (p: number) => void
  noun?: string
}

export function Pagination({ page, pageSize, total, onPage, noun = 'items' }: Props) {
  const totalPages = Math.ceil(total / pageSize)
  if (totalPages <= 1) return null
  const start = page * pageSize + 1
  const end = Math.min((page + 1) * pageSize, total)
  return (
    <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 px-1 text-sm text-slate-500">
      <span className="tabular-nums">Showing {start}–{end} of {total.toLocaleString()} {noun}</span>
      <div className="flex items-center justify-between sm:justify-end gap-2">
        {/* `.btn-secondary` is 44pt mobile / 36px desktop — keeps prev/next
            comfortably tappable without making the desktop layout boxy. */}
        <button
          className="btn-secondary px-3"
          disabled={page === 0}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          ← Prev
        </button>
        <span className="tabular-nums text-slate-600 dark:text-slate-300">{page + 1} / {totalPages}</span>
        <button
          className="btn-secondary px-3"
          disabled={page >= totalPages - 1}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          Next →
        </button>
      </div>
    </div>
  )
}
