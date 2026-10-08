// Shared plumbing for every Edge Function: CORS, authentication, input validation, and a
// service-role database client. The service role key lives only here, on the server.
import { createClient } from 'npm:@supabase/supabase-js@2'
import type { z } from 'npm:zod@4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
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
    if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    if (request.method !== 'POST') return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405)

    try {
      const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
      if (!token) return json({ ok: false, code: 'NOT_AUTHENTICATED' }, 401)
      // Asks the auth server, so a revoked or deleted account is refused even with an unexpired token.
      const { data, error } = await admin.auth.getUser(token)
      if (error || !data.user) return json({ ok: false, code: 'NOT_AUTHENTICATED' }, 401)

      let raw: unknown
      try {
        raw = await request.json()
      } catch {
        return json({ ok: false, code: 'BAD_REQUEST' }, 400)
      }
      const parsed = schema.safeParse(raw)
      if (!parsed.success) return json({ ok: false, code: 'BAD_REQUEST' }, 400)

      return await handler({ userId: data.user.id, body: parsed.data })
    } catch (error) {
      console.error('[function error]', error)
      return json({ ok: false, code: 'SERVER_ERROR' }, 500)
    }
  })
}
