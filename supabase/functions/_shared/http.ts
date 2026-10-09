// Shared plumbing for every Edge Function: CORS, authentication, input validation, and a
// service-role database client. The service role key lives only here, on the server.
import { createClient } from 'npm:@supabase/supabase-js@2'
import type { z } from 'npm:zod@4'

// Which websites' pages may call these functions from a browser. Set the secret APP_ORIGINS to
// the app's address(es), separated by commas (for example
// "https://play.example.com,http://localhost:5173"), and browsers on any other site are refused.
// Left unset, any site may call: a request still needs a signed-in player's own session token,
// which another site has no way to obtain, so this is a second lock, not the only one.
const allowedOrigins = (Deno.env.get('APP_ORIGINS') ?? '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean)

function corsFor(request: Request | null): Record<string, string> {
  const origin = request?.headers.get('Origin') ?? null
  const allow = allowedOrigins.length === 0 ? '*' : origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0]!
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}
// Before its first call to a function, a browser asks permission (a "preflight"), which is a
// whole extra trip to the server. Unless told otherwise it asks again every few seconds, so
// nearly every move in a game paid for two trips. This lets it remember the answer (browsers
// cap it: about two hours in Chrome, a day in Firefox). The real request is still checked in
// full every time; only the question "may this site call at all?" is remembered.
const PREFLIGHT_MAX_AGE_SECONDS = '86400'

/** True when the request comes from a browser on a site that is not ours. */
function foreignSite(request: Request): boolean {
  const origin = request.headers.get('Origin')
  return allowedOrigins.length > 0 && origin !== null && !allowedOrigins.includes(origin)
}

export function json(body: unknown, status = 200, request: Request | null = null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsFor(request), 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  })
}

// A limit on how fast one player may call one function: far above anything a person playing
// does, well below what a script hammering the server does. Counted in this server instance's
// memory, so it costs nothing per request; it is a brake, not an exact meter.
const WINDOW_MS = 10_000
const MAX_CALLS = 60
const calls = new Map<string, number[]>()
function tooFast(userId: string): boolean {
  const now = Date.now()
  const recent = (calls.get(userId) ?? []).filter((at) => now - at < WINDOW_MS)
  recent.push(now)
  calls.set(userId, recent)
  // Keep the memory small: forget players who have gone quiet.
  if (calls.size > 5000) for (const [id, times] of calls) if (now - (times.at(-1) ?? 0) > WINDOW_MS) calls.delete(id)
  return recent.length > MAX_CALLS
}

/** An expected "no" (not your turn, game over...). Sent as a normal response the app can read. */
export const refuse = (code: string) => json({ ok: false, code })

export const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})

type Handler<T> = (context: { userId: string; body: T }) => Promise<Response>

/**
 * Wraps a function body: answers CORS preflights, accepts POST only, identifies the caller from
 * their session token (never from anything in the request body), and validates the input.
 */
export function serve<S extends z.ZodType>(schema: S, handler: Handler<z.infer<S>>) {
  Deno.serve(async (request) => {
    if (request.method === 'OPTIONS') {
      // A refusal is never remembered.
      return foreignSite(request)
        ? new Response('ok', { status: 403, headers: corsFor(request) })
        : new Response('ok', { status: 200, headers: { ...corsFor(request), 'Access-Control-Max-Age': PREFLIGHT_MAX_AGE_SECONDS } })
    }
    if (foreignSite(request)) return json({ ok: false, code: 'FORBIDDEN' }, 403, request)
    if (request.method !== 'POST') return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405, request)

    try {
      const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
      if (!token) return json({ ok: false, code: 'NOT_AUTHENTICATED' }, 401, request)
      // Asks the auth server, so a revoked or deleted account is refused even with an unexpired token.
      const { data, error } = await admin.auth.getUser(token)
      if (error || !data.user) return json({ ok: false, code: 'NOT_AUTHENTICATED' }, 401, request)
      if (tooFast(data.user.id)) return json({ ok: false, code: 'RATE_LIMITED' }, 429, request)

      let raw: unknown
      try {
        raw = await request.json()
      } catch {
        return json({ ok: false, code: 'BAD_REQUEST' }, 400, request)
      }
      const parsed = schema.safeParse(raw)
      if (!parsed.success) return json({ ok: false, code: 'BAD_REQUEST' }, 400, request)

      const response = await handler({ userId: data.user.id, body: parsed.data })
      // Replies the function builds itself (json, refuse) do not know the caller: give them its headers.
      for (const [name, value] of Object.entries(corsFor(request))) response.headers.set(name, value)
      return response
    } catch (error) {
      console.error('[function error]', error)
      return json({ ok: false, code: 'SERVER_ERROR' }, 500, request)
    }
  })
}
