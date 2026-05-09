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
    <div className="flex items-center justify-between mt-3 px-1 text-sm text-slate-500">
      <span>Showing {start}–{end} of {total.toLocaleString()} {noun}</span>
      <div className="flex items-center gap-2">
        <button
          className="btn-secondary py-1 px-3"
          disabled={page === 0}
          onClick={() => onPage(page - 1)}
        >
          ← Prev
        </button>
        <span className="tabular-nums">{page + 1} / {totalPages}</span>
        <button
          className="btn-secondary py-1 px-3"
          disabled={page >= totalPages - 1}
          onClick={() => onPage(page + 1)}
        >
          Next →
        </button>
      </div>
    </div>
  )
}
