// The one door into the admin system. The admin app (a separate application from the player
// app) sends every request here as { action, params }.
//
// Before anything runs, each request must show:
//   1. a valid session token (checked with the auth server, so a revoked account is refused),
//   2. that the account is in public.admins,
//   3. that the session passed the second sign-in step (authenticator app code), except for
//      the "session" action, which only reports what is still missing.
// Only then is the matching admin_* database function called with the service role. Those
// functions write the audit log themselves, in the same transaction as the change.
//
// Optional: set the secret ADMIN_APP_ORIGIN to the admin app's address (for example
// https://admin.example.com) and browsers on any other site are refused.
import { z } from 'npm:zod@4'
import { admin } from '../_shared/http.ts'

const allowedOrigin = Deno.env.get('ADMIN_APP_ORIGIN')?.replace(/\/$/, '') || null

function reply(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Access-Control-Allow-Origin': allowedOrigin ?? request.headers.get('Origin') ?? '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      Vary: 'Origin',
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

const uuid = z.uuid()
const reason = z.string().trim().min(5).max(500)
const page = { limit: z.optional(z.int().min(1).max(200)), offset: z.optional(z.int().min(0)) }

type Call = { fn: string; args: Record<string, unknown> }
type Action<S extends z.ZodType> = { params: S; call: (params: z.infer<S>, adminId: string) => Call }
const action = <S extends z.ZodType>(params: S, call: Action<S>['call']): Action<S> => ({ params, call })

// Every action the admin app can ask for. Anything not listed here does not exist.
// deno-lint-ignore no-explicit-any
const ACTIONS: Record<string, Action<any>> = {
  overview: action(z.object({}), () => ({ fn: 'admin_overview', args: {} })),

  'players.search': action(z.object({ query: z.optional(z.string().max(100)), ...page }), (p) => ({
    fn: 'admin_search_players',
    args: { p_query: p.query ?? null, p_limit: p.limit ?? 25, p_offset: p.offset ?? 0 },
  })),
  'players.get': action(z.object({ userId: uuid }), (p) => ({ fn: 'admin_player', args: { p_user_id: p.userId } })),
  'players.ban': action(z.object({ userId: uuid, banned: z.boolean(), reason }), (p, adminId) => ({
    fn: 'admin_set_ban',
    args: { p_admin_id: adminId, p_user_id: p.userId, p_banned: p.banned, p_reason: p.reason },
  })),
  'players.adjust': action(
    z.object({
      userId: uuid,
      // Whole tokens, never fractions; the database applies its own ceiling as well.
      amount: z.int().min(-1_000_000).max(1_000_000),
      balanceType: z.enum(['bonus', 'cash']),
      reason,
    }),
    (p, adminId) => ({
      fn: 'admin_adjust_balance',
      args: { p_admin_id: adminId, p_user_id: p.userId, p_amount: p.amount, p_balance_type: p.balanceType, p_reason: p.reason },
    }),
  ),

  'matches.list': action(z.object({ status: z.optional(z.enum(['waiting', 'active', 'finished', 'aborted'])), ...page }), (p) => ({
    fn: 'admin_matches',
    args: { p_status: p.status ?? null, p_limit: p.limit ?? 25, p_offset: p.offset ?? 0 },
  })),
  'matches.get': action(z.object({ matchId: uuid }), (p) => ({ fn: 'admin_match', args: { p_match_id: p.matchId } })),
  'matches.abort': action(z.object({ matchId: uuid, reason }), (p, adminId) => ({
    fn: 'admin_abort_match',
    args: { p_admin_id: adminId, p_match_id: p.matchId, p_reason: p.reason },
  })),

  'reports.list': action(z.object({ status: z.optional(z.enum(['open', 'resolved', 'dismissed'])), ...page }), (p) => ({
    fn: 'admin_reports',
    args: { p_status: p.status ?? null, p_limit: p.limit ?? 25, p_offset: p.offset ?? 0 },
  })),
  'reports.resolve': action(
    z.object({ reportId: z.int().min(1), status: z.enum(['resolved', 'dismissed']), note: z.optional(z.string().trim().max(500)) }),
    (p, adminId) => ({
      fn: 'admin_resolve_report',
      args: { p_admin_id: adminId, p_report_id: p.reportId, p_status: p.status, p_note: p.note ?? null },
    }),
  ),

  revenue: action(z.object({ days: z.optional(z.int().min(1).max(90)) }), (p) => ({ fn: 'admin_revenue', args: { p_days: p.days ?? 14 } })),
  integrity: action(z.object({}), () => ({ fn: 'admin_integrity', args: {} })),
  audit: action(z.object(page), (p) => ({ fn: 'admin_audit', args: { p_limit: p.limit ?? 50, p_offset: p.offset ?? 0 } })),
}

const Body = z.object({ action: z.string().max(40), params: z.optional(z.record(z.string(), z.unknown())) })

/** The sign-in strength recorded in the session token: aal2 means the second step was passed. */
function assuranceLevel(token: string): string | null {
  try {
    const payload = token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')
    return (JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='))) as { aal?: string }).aal ?? null
  } catch {
    return null
  }
}

Deno.serve(async (request) => {
  const origin = request.headers.get('Origin')
  if (allowedOrigin && origin && origin.replace(/\/$/, '') !== allowedOrigin) {
    return reply(request, { ok: false, code: 'FORBIDDEN' }, 403)
  }
  if (request.method === 'OPTIONS') return reply(request, 'ok')
  if (request.method !== 'POST') return reply(request, { ok: false, code: 'METHOD_NOT_ALLOWED' }, 405)

  try {
    const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return reply(request, { ok: false, code: 'NOT_AUTHENTICATED' }, 401)
    const { data, error } = await admin.auth.getUser(token)
    if (error || !data.user) return reply(request, { ok: false, code: 'NOT_AUTHENTICATED' }, 401)
    const adminId = data.user.id

    const membership = await admin.from('admins').select('user_id').eq('user_id', adminId).maybeSingle()
    if (membership.error) throw membership.error
    if (!membership.data) {
      console.warn('[admin-api] refused non-admin', adminId)
      return reply(request, { ok: false, code: 'NOT_ADMIN' }, 403)
    }

    let raw: unknown
    try {
      raw = await request.json()
    } catch {
      return reply(request, { ok: false, code: 'BAD_REQUEST' }, 400)
    }
    const body = Body.safeParse(raw)
    if (!body.success) return reply(request, { ok: false, code: 'BAD_REQUEST' }, 400)

    const secondStepPassed = assuranceLevel(token) === 'aal2'
    // The only thing an admin can do before the second step: learn that it is still needed.
    if (body.data.action === 'session') {
      return reply(request, { ok: true, data: { admin: true, secondStepPassed, email: data.user.email ?? null } })
    }
    if (!secondStepPassed) return reply(request, { ok: false, code: 'SECOND_STEP_REQUIRED' }, 403)

    const wanted = ACTIONS[body.data.action]
    if (!wanted) return reply(request, { ok: false, code: 'UNKNOWN_ACTION' }, 400)
    const params = wanted.params.safeParse(body.data.params ?? {})
    if (!params.success) return reply(request, { ok: false, code: 'BAD_REQUEST' }, 400)

    const { fn, args } = wanted.call(params.data, adminId)
    const result = await admin.rpc(fn, args)
    if (result.error) throw result.error

    // Functions that change something answer { ok, code? } themselves; lookups answer with data.
    const value = result.data as { ok?: boolean; code?: string } | null
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.ok === 'boolean') {
      return reply(request, value.ok ? { ok: true, data: value } : { ok: false, code: value.code ?? 'REFUSED' })
    }
    return reply(request, { ok: true, data: value })
  } catch (error) {
    console.error('[admin-api error]', error)
    return reply(request, { ok: false, code: 'SERVER_ERROR' }, 500)
  }
})
