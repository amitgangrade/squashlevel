// Supabase Edge Function: send-match-email
// Deploy: `supabase functions deploy send-match-email`
// Required secrets (set via `supabase secrets set KEY=value`):
//   RESEND_API_KEY   — Resend API key
//   EMAIL_FROM       — e.g. "Spring Tropica Squash <updates@yourdomain.com>"
//   SITE_URL         — e.g. "https://amitgangrade.github.io/squashlevel/"
//
// Invoked from the client after a match is saved with `{ matchId }`.

// @ts-expect-error deno module
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-expect-error deno module
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// @ts-expect-error Deno global
const env = Deno.env

const SUPABASE_URL = env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = env.get('RESEND_API_KEY')
const EMAIL_FROM = env.get('EMAIL_FROM') ?? 'Spring Tropica Squash <onboarding@resend.dev>'
const SITE_URL = env.get('SITE_URL') ?? 'https://amitgangrade.github.io/squashlevel/'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }
  try {
    if (!RESEND_API_KEY) {
      return json({ skipped: true, reason: 'RESEND_API_KEY not set' }, 200)
    }
    const { matchId } = await req.json()
    if (!matchId) return json({ error: 'matchId required' }, 400)

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const { data: m, error: mErr } = await sb.from('matches').select('*').eq('id', matchId).single()
    if (mErr || !m) return json({ error: 'match not found' }, 404)

    const { data: players, error: pErr } = await sb
      .from('players')
      .select('id, name, email')
      .in('id', [m.player_a_id, m.player_b_id])
    if (pErr || !players) return json({ error: 'players not found' }, 404)

    const a = players.find((p: { id: string }) => p.id === m.player_a_id)
    const b = players.find((p: { id: string }) => p.id === m.player_b_id)
    if (!a || !b) return json({ error: 'missing player' }, 404)

    const recipients = [a.email, b.email].filter((e: string | null): e is string => Boolean(e))
    if (recipients.length === 0) return json({ skipped: true, reason: 'no recipient emails' }, 200)

    const games: Array<{ a: number; b: number }> = m.games
    const scoreLine = games.map((g) => `${g.a}-${g.b}`).join(', ')
    const aGames = games.filter((g) => g.a > g.b).length
    const bGames = games.filter((g) => g.b > g.a).length
    const winner = aGames > bGames ? a.name : b.name
    const subject = `${a.name} vs ${b.name} — ${aGames}-${bGames} (${winner} wins)`
    const html = `
      <div style="font-family:system-ui,sans-serif;color:#0f172a;max-width:560px">
        <div style="background:linear-gradient(135deg,#dc2626,#06b6d4);color:#fff;padding:18px 20px;border-radius:10px 10px 0 0">
          <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;opacity:0.9">Spring Tropica Squash Group · Singapore</div>
          <div style="font-size:20px;font-weight:700;margin-top:4px">Match logged</div>
        </div>
        <div style="border:1px solid #e2e8f0;border-top:0;border-radius:0 0 10px 10px;padding:20px">
          <h2 style="margin:0 0 8px;font-size:18px">${escapeHtml(a.name)} vs ${escapeHtml(b.name)}</h2>
          <p style="margin:4px 0"><strong>${escapeHtml(winner)}</strong> wins ${aGames}-${bGames}.</p>
          <p style="margin:4px 0">Games: ${escapeHtml(scoreLine)}</p>
          <p style="margin:4px 0;color:#64748b;font-size:13px">Match type: ${escapeHtml(m.type)} · Date: ${escapeHtml(m.date)}</p>
          ${m.notes ? `<p style="margin:8px 0;color:#475569">Notes: ${escapeHtml(m.notes)}</p>` : ''}
          <p style="margin-top:16px"><a href="${SITE_URL}" style="color:#dc2626;font-weight:600">Open Spring Tropica Squash Group →</a></p>
        </div>
      </div>
    `

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: EMAIL_FROM, to: recipients, subject, html }),
    })
    if (!resp.ok) {
      const text = await resp.text()
      return json({ error: 'resend failed', status: resp.status, detail: text }, 500)
    }
    return json({ ok: true, sent: recipients.length })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  })
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
