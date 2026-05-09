import { useState } from 'react'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const SITE_URL = (import.meta.env.VITE_SITE_URL as string | undefined) ?? window.location.origin

/**
 * Share URL strategy:
 *  • The "human" URL is the SPA hash route — opens directly in the app.
 *  • The "social" URL goes to a Supabase Edge Function `share` that returns
 *    a tiny HTML doc with og:* meta tags pointing at a generated PNG, then
 *    redirects the browser to the SPA route. Crawlers (Twitter, WhatsApp,
 *    Slack, Facebook) read the meta tags; humans get to the app.
 *
 * If the project isn't configured with Supabase (env missing), we fall back
 * to copying the SPA URL directly — still useful, just won't render a card.
 */
export function buildShareUrl(kind: 'player' | 'match', id: string): string {
  if (SUPABASE_URL) {
    return `${SUPABASE_URL}/functions/v1/share?kind=${kind}&id=${encodeURIComponent(id)}`
  }
  // Fallback: link straight to the SPA.
  return `${SITE_URL}/#/${kind === 'player' ? 'players' : 'matches'}/${id}`
}

interface Props {
  kind: 'player' | 'match'
  id: string
  title: string
}

export function ShareButton({ kind, id, title }: Props) {
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  const url = buildShareUrl(kind, id)

  const onShare = async () => {
    setBusy(true)
    try {
      // Prefer the native share sheet on mobile (it gives the user OS-level
      // copy/share-to-app affordances). Fall back to clipboard on desktop.
      if (navigator.share) {
        await navigator.share({ title, url })
      } else {
        await navigator.clipboard.writeText(url)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    } catch {
      // User cancelled the share sheet — silent.
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={onShare}
      disabled={busy}
      className="btn-secondary text-xs"
      aria-label="Share link"
    >
      {copied ? 'Link copied' : busy ? '…' : 'Share'}
    </button>
  )
}
