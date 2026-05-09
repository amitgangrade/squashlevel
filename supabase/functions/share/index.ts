// Supabase Edge Function: share
//
// Returns a tiny HTML page with og:* meta tags + a JS redirect to the SPA.
// Social-media scrapers see the OG tags; humans bounce through to the app.
//
// Routes:
//   GET /functions/v1/share?kind=player&id=<uuid>
//   GET /functions/v1/share?kind=match&id=<uuid>
//   GET /functions/v1/share/og?kind=player&id=<uuid>   → returns SVG image
//
// Env:
//   SUPABASE_URL                 (auto)
//   SUPABASE_SERVICE_ROLE_KEY    (auto)
//   SITE_URL                     e.g. https://boast.app/
//
// Deploy: `supabase functions deploy share --no-verify-jwt`
//
// We use SVG for the OG image because (a) it renders crisply at any DPR,
// (b) it requires no external font/image deps in Deno, (c) Twitter/X,
// Facebook, LinkedIn, Slack, and WhatsApp all accept SVG in og:image. If
// you find a crawler that doesn't, swap to a Satori-based PNG generator.

// @ts-expect-error deno module
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-expect-error deno module
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// @ts-expect-error Deno global
const env = Deno.env
const SUPABASE_URL = env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SITE_URL = (env.get('SITE_URL') ?? 'https://boast.app/').replace(/\/+$/, '/')

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const url = new URL(req.url)
  const path = url.pathname.replace(/.*\/share/, '')
  const kind = url.searchParams.get('kind')
  const id = url.searchParams.get('id')
  if (!kind || !id) return text('kind and id required', 400)

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  if (path.endsWith('/og')) {
    if (kind === 'player') {
      const data = await loadPlayer(sb, id)
      if (!data) return text('not found', 404)
      return svg(playerCardSvg(data))
    }
    if (kind === 'match') {
      const data = await loadMatch(sb, id)
      if (!data) return text('not found', 404)
      return svg(matchCardSvg(data))
    }
    return text('unknown kind', 400)
  }

  // Default: HTML doc with meta tags + JS redirect.
  if (kind === 'player') {
    const p = await loadPlayer(sb, id)
    if (!p) return html(genericHtml('Player not found', SITE_URL))
    const ogImage = `${SUPABASE_URL}/functions/v1/share/og?kind=player&id=${id}`
    const target = `${SITE_URL}#/players/${id}`
    return html(buildHtml({
      title: `${p.name} on Boast`,
      desc: `${formatLevel(p.level)} · ${p.matches} ${p.matches === 1 ? 'match' : 'matches'}${p.club ? ' · ' + p.club : ''}`,
      ogImage,
      target,
    }))
  }
  if (kind === 'match') {
    const m = await loadMatch(sb, id)
    if (!m) return html(genericHtml('Match not found', SITE_URL))
    const ogImage = `${SUPABASE_URL}/functions/v1/share/og?kind=match&id=${id}`
    const target = `${SITE_URL}#/history`
    return html(buildHtml({
      title: `${m.aName} ${m.aGames}-${m.bGames} ${m.bName}`,
      desc: `${m.winnerName} wins on Boast · ${m.date}`,
      ogImage,
      target,
    }))
  }
  return text('unknown kind', 400)
})

interface PlayerCard {
  name: string
  level: number
  startingLevel: number
  matches: number
  wins: number
  losses: number
  club?: string
  city?: string
  country?: string
  avatarUrl?: string
}

interface MatchCard {
  aName: string
  bName: string
  aGames: number
  bGames: number
  winnerName: string
  date: string
}

async function loadPlayer(sb: ReturnType<typeof createClient>, id: string): Promise<PlayerCard | null> {
  const { data: p } = await sb
    .from('players')
    .select('name, starting_level, club, city, country, avatar_url')
    .eq('id', id)
    .maybeSingle()
  if (!p) return null

  // Cheap roll-up: we don't recompute the rating server-side; just use the
  // starting_level for now. (A future enhancement: persist current_level
  // on the player row when matches are confirmed.)
  const { data: ms } = await sb
    .from('matches')
    .select('player_a_id, player_b_id, games, status')
    .or(`player_a_id.eq.${id},player_b_id.eq.${id}`)
  let wins = 0
  let losses = 0
  for (const m of ms ?? []) {
    if (m.status !== 'confirmed') continue
    let aGames = 0, bGames = 0
    for (const g of (m.games as Array<{ a: number; b: number }>) ?? []) {
      if (g.a > g.b) aGames++
      else if (g.b > g.a) bGames++
    }
    const isA = (m as { player_a_id: string }).player_a_id === id
    if (aGames === bGames) continue
    const won = (isA && aGames > bGames) || (!isA && bGames > aGames)
    if (won) wins++
    else losses++
  }

  return {
    name: (p as { name: string }).name,
    level: Number((p as { starting_level: number }).starting_level),
    startingLevel: Number((p as { starting_level: number }).starting_level),
    matches: wins + losses,
    wins,
    losses,
    club: (p as { club?: string }).club ?? undefined,
    city: (p as { city?: string }).city ?? undefined,
    country: (p as { country?: string }).country ?? undefined,
    avatarUrl: (p as { avatar_url?: string }).avatar_url ?? undefined,
  }
}

async function loadMatch(sb: ReturnType<typeof createClient>, id: string): Promise<MatchCard | null> {
  const { data: m } = await sb
    .from('matches')
    .select('player_a_id, player_b_id, games, date')
    .eq('id', id)
    .maybeSingle()
  if (!m) return null
  const { data: ps } = await sb
    .from('players')
    .select('id, name')
    .in('id', [(m as { player_a_id: string }).player_a_id, (m as { player_b_id: string }).player_b_id])
  const map = new Map<string, string>(
    (ps ?? []).map((p) => [(p as { id: string }).id, (p as { name: string }).name]),
  )
  let aGames = 0, bGames = 0
  for (const g of (m as { games: Array<{ a: number; b: number }> }).games ?? []) {
    if (g.a > g.b) aGames++
    else if (g.b > g.a) bGames++
  }
  const aName = map.get((m as { player_a_id: string }).player_a_id) ?? 'Player A'
  const bName = map.get((m as { player_b_id: string }).player_b_id) ?? 'Player B'
  return {
    aName,
    bName,
    aGames,
    bGames,
    winnerName: aGames > bGames ? aName : bName,
    date: (m as { date: string }).date,
  }
}

// ---------- HTML / SVG builders --------------------------------------------

function buildHtml({ title, desc, ogImage, target }: { title: string; desc: string; ogImage: string; target: string }): string {
  const t = escapeHtml(title)
  const d = escapeHtml(desc)
  const img = escapeHtml(ogImage)
  const tgt = escapeHtml(target)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${t}</title>
  <meta name="description" content="${d}" />
  <meta property="og:title" content="${t}" />
  <meta property="og:description" content="${d}" />
  <meta property="og:image" content="${img}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${tgt}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${t}" />
  <meta name="twitter:description" content="${d}" />
  <meta name="twitter:image" content="${img}" />
  <meta http-equiv="refresh" content="0; url=${tgt}" />
  <style>
    body { font-family: system-ui, sans-serif; padding: 24px; color: #0f172a; background: #f8fafc; }
    a { color: #4f46e5; }
  </style>
</head>
<body>
  <p>Redirecting to <a href="${tgt}">Boast</a>…</p>
  <script>window.location.replace(${JSON.stringify(target)});</script>
</body>
</html>`
}

function genericHtml(title: string, target: string): string {
  return buildHtml({ title, desc: 'Squash ratings, free forever.', ogImage: '', target })
}

function playerCardSvg(p: PlayerCard): string {
  const w = 1200, h = 630
  const winRate = p.matches > 0 ? Math.round((p.wins / p.matches) * 100) : null
  const meta = [p.club, p.city, p.country].filter(Boolean).join(' · ')
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a" />
      <stop offset="100%" stop-color="#312e81" />
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)" />
  <!-- Tin strip nod -->
  <rect x="0" y="${h - 18}" width="${w}" height="6" fill="#e03a3a" />
  <!-- Brand mark -->
  <g transform="translate(48, 48)">
    <rect width="56" height="56" rx="12" fill="#111827" />
    <circle cx="44" cy="18" r="8" fill="#f5e000" />
    <text x="28" y="40" text-anchor="middle" font-family="Inter, sans-serif" font-weight="900" font-size="34" fill="#ffffff">B</text>
  </g>
  <text x="120" y="92" font-family="Inter, sans-serif" font-size="22" fill="#cbd5e1" letter-spacing="6">BOAST · SQUASH</text>
  <!-- Name -->
  <text x="48" y="280" font-family="Inter, sans-serif" font-size="84" font-weight="800" fill="#ffffff">${escapeXml(truncate(p.name, 24))}</text>
  ${meta ? `<text x="48" y="330" font-family="Inter, sans-serif" font-size="28" fill="#a5b4fc">${escapeXml(truncate(meta, 60))}</text>` : ''}
  <!-- Big level -->
  <g transform="translate(48, 400)">
    <text font-family="Inter, sans-serif" font-size="22" fill="#94a3b8">CURRENT LEVEL</text>
    <text y="100" font-family="Inter, sans-serif" font-size="120" font-weight="800" fill="#fde047">${formatLevel(p.level)}</text>
  </g>
  <g transform="translate(560, 400)">
    <text font-family="Inter, sans-serif" font-size="22" fill="#94a3b8">RECORD</text>
    <text y="100" font-family="Inter, sans-serif" font-size="80" font-weight="700" fill="#ffffff">${p.wins}W · ${p.losses}L</text>
    ${winRate != null ? `<text y="150" font-family="Inter, sans-serif" font-size="32" fill="#a5b4fc">${winRate}% win rate</text>` : ''}
  </g>
</svg>`
}

function matchCardSvg(m: MatchCard): string {
  const w = 1200, h = 630
  const aWin = m.aGames > m.bGames
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a" />
      <stop offset="100%" stop-color="#0f4c5c" />
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)" />
  <rect x="0" y="${h - 18}" width="${w}" height="6" fill="#e03a3a" />
  <g transform="translate(48, 48)">
    <rect width="56" height="56" rx="12" fill="#111827" />
    <circle cx="44" cy="18" r="8" fill="#f5e000" />
    <text x="28" y="40" text-anchor="middle" font-family="Inter, sans-serif" font-weight="900" font-size="34" fill="#ffffff">B</text>
  </g>
  <text x="120" y="92" font-family="Inter, sans-serif" font-size="22" fill="#cbd5e1" letter-spacing="6">BOAST · MATCH RESULT</text>
  <g transform="translate(48, 220)">
    <text font-family="Inter, sans-serif" font-size="${m.aName.length > 18 ? 56 : 72}" font-weight="800" fill="${aWin ? '#fde047' : '#e2e8f0'}">${escapeXml(truncate(m.aName, 22))}</text>
    <text y="80" font-family="Inter, sans-serif" font-size="${m.bName.length > 18 ? 56 : 72}" font-weight="800" fill="${!aWin ? '#fde047' : '#e2e8f0'}">${escapeXml(truncate(m.bName, 22))}</text>
  </g>
  <g transform="translate(820, 240)">
    <text font-family="Inter, sans-serif" font-size="200" font-weight="800" fill="#ffffff" text-anchor="end">${m.aGames}–${m.bGames}</text>
  </g>
  <text x="48" y="${h - 60}" font-family="Inter, sans-serif" font-size="26" fill="#94a3b8">${escapeXml(m.date)}</text>
</svg>`
}

function formatLevel(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…'
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c))
}
function escapeXml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] || c))
}

function html(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300', ...cors },
  })
}
function svg(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=300', ...cors },
  })
}
function text(body: string, status = 200) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain', ...cors } })
}
