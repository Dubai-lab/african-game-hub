// Helpers for the live suite: signed-in players, the Edge Functions, and database access.
//
// Two kinds of database access are used. Reading results back goes through the ordinary
// database API with the service role (fast, no request limit to speak of). Calling internal
// functions directly, which only the database owner may do, goes through the Management API
// (`runSql`), which is rate-limited, so it is kept for the attacks themselves.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { requireEnv, runSql } from '../../scripts/lib/managementApi.ts'
import { ensureTestAccounts, resetTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../../scripts/lib/testAccounts.ts'

export { runSql, resetTestAccounts }

export type Player = { name: string; id: string; client: SupabaseClient }
export type Reply = {
  ok?: boolean
  code?: string
  status?: string
  match_id?: string | null
  finished?: boolean
  san?: string
  clock?: string
  ply?: number
}

const url = requireEnv('VITE_SUPABASE_URL')
const anonKey = requireEnv('VITE_SUPABASE_ANON_KEY')
const noSession = { auth: { persistSession: false, autoRefreshToken: false } }

/** Service-role client, for reading results back. Never used to change game or money state. */
export const admin = createClient(url, requireEnv('SUPABASE_SERVICE_ROLE_KEY'), noSession)

function rows<T>(result: { data: unknown; error: { message: string } | null }): T[] {
  if (result.error) throw new Error(result.error.message)
  return (result.data ?? []) as T[]
}

/** Signs in every test account. Each gets its own client, like a separate phone. */
export async function signInPlayers(): Promise<Player[]> {
  await ensureTestAccounts()
  return Promise.all(
    TEST_ACCOUNTS.map(async (account) => {
      const client = createClient(url, anonKey, noSession)
      const { data, error } = await client.auth.signInWithPassword({ email: account.email, password: TEST_PASSWORD })
      if (error || !data.user) throw error ?? new Error(`could not sign in ${account.email}`)
      return { name: account.username, id: data.user.id, client }
    }),
  )
}

export async function call(who: Player, fn: string, body: Record<string, unknown>): Promise<Reply> {
  const { data, error } = await who.client.functions.invoke(fn, { body })
  if (error) return { ok: false, code: `HTTP_ERROR: ${error.message}` }
  return data as Reply
}

export const join = (who: Player, stake: number, timeControl = '3+2') =>
  call(who, 'core-join-queue', { game_type: 'chess', stake, options: { time_control: timeControl } })

export const move = (who: Player, matchId: string, uci: string, ply: number) =>
  call(who, 'chess-make-move', { match_id: matchId, uci, ply })

export const act = (who: Player, matchId: string, action: string) =>
  call(who, 'chess-game-action', { match_id: matchId, action })

/** `count` copies of the same request, sent at the same moment. */
export const burst = <T>(count: number, request: () => Promise<T>) => Promise.all(Array.from({ length: count }, request))

export async function wallet(who: Player) {
  const [row] = rows<{ bonus_balance: number; cash_balance: number }>(
    await admin.from('wallets').select('bonus_balance, cash_balance').eq('user_id', who.id),
  )
  return { bonus: row!.bonus_balance, cash: row!.cash_balance }
}

/** Sets a wallet to exact balances, through ledger adjustments like any other change. */
export async function setBalance(who: Player, bonus: number, cash = 0) {
  await runSql(`
    select private.apply_ledger_entry(w.user_id, ${bonus} - w.bonus_balance, 'bonus', 'adjustment')
      from public.wallets w where w.user_id = '${who.id}' and w.bonus_balance <> ${bonus};
    select private.apply_ledger_entry(w.user_id, ${cash} - w.cash_balance, 'cash', 'adjustment')
      from public.wallets w where w.user_id = '${who.id}' and w.cash_balance <> ${cash};`)
}

const ids = (players: Player[]) => players.map((p) => p.id)

/** Matches in progress that involve any of these players, with everyone seated in each. */
export async function activeMatches(players: Player[]) {
  const seats = rows<{ match_id: string; user_id: string; matches: { status: string; stake_amount: number } }>(
    await admin
      .from('match_players')
      .select('match_id, user_id, matches!inner (status, stake_amount)')
      .in('user_id', ids(players))
      .eq('matches.status', 'active'),
  )
  const byMatch = new Map<string, { match_id: string; stake: number; players: string[] }>()
  for (const seat of seats) {
    const entry = byMatch.get(seat.match_id) ?? { match_id: seat.match_id, stake: seat.matches.stake_amount, players: [] }
    entry.players.push(seat.user_id)
    byMatch.set(seat.match_id, entry)
  }
  return [...byMatch.values()].map((m) => ({ ...m, players: m.players.sort() }))
}

export async function queued(players: Player[]) {
  return rows<{ user_id: string }>(await admin.from('match_queue').select('user_id').in('user_id', ids(players))).map((r) => r.user_id)
}

/** Pairs two players in a fresh game and says who has which colour. */
export async function startGame(a: Player, b: Player, stake: number, timeControl = '3+2') {
  const first = await join(a, stake, timeControl)
  const second = await join(b, stake, timeControl)
  if (first.status !== 'queued' || second.status !== 'matched' || !second.match_id) {
    throw new Error(`could not pair ${a.name} and ${b.name}: ${JSON.stringify([first, second])}`)
  }
  const seats = rows<{ user_id: string; seat: string }>(
    await admin.from('match_players').select('user_id, seat').eq('match_id', second.match_id),
  )
  const white = seats.find((s) => s.seat === 'white')!.user_id === a.id ? a : b
  return { matchId: second.match_id, white, black: white === a ? b : a }
}

export async function matchState(matchId: string) {
  const [match, game, moves, ledger, revenue, escrow] = await Promise.all([
    admin.from('matches').select('status, result, end_reason, settled, winner_id').eq('id', matchId),
    admin.from('chess_games').select('ply, white_time_ms, black_time_ms').eq('match_id', matchId),
    admin.from('chess_moves').select('ply, san').eq('match_id', matchId).order('ply'),
    admin.from('ledger_entries').select('entry_type').eq('match_id', matchId),
    admin.from('platform_revenue').select('amount').eq('match_id', matchId),
    admin.from('escrow').select('amount, status').eq('match_id', matchId),
  ])
  const m = rows<{ status: string; result: string | null; end_reason: string | null; settled: boolean; winner_id: string | null }>(match)[0]!
  const g = rows<{ ply: number; white_time_ms: number; black_time_ms: number }>(game)[0]!
  const entries = rows<{ entry_type: string }>(ledger)
  const rakeRows = rows<{ amount: number }>(revenue)
  return {
    ...m,
    ply: g.ply,
    whiteMs: g.white_time_ms,
    blackMs: g.black_time_ms,
    sans: rows<{ san: string }>(moves).map((r) => r.san),
    moves: rows(moves).length,
    payouts: entries.filter((e) => e.entry_type === 'win_payout').length,
    refunds: entries.filter((e) => e.entry_type === 'stake_refund').length,
    revenue_rows: rakeRows.length,
    rake: rakeRows.reduce((sum, r) => sum + r.amount, 0),
    held: rows<{ amount: number; status: string }>(escrow)
      .filter((e) => e.status === 'held')
      .reduce((sum, e) => sum + e.amount, 0),
  }
}

export async function ratings(players: Player[], pool: string) {
  return rows<{ user_id: string; rating: number; games_played: number }>(
    await admin.from('player_ratings').select('user_id, rating, games_played').in('user_id', ids(players)).eq('pool', pool),
  )
}

export async function integrityProblems() {
  return rows<{ check_name: string; detail: string }>(await admin.rpc('verify_ledger_integrity'))
}

/** Sum of every token the given players hold, in wallets and in escrow. */
export async function tokensHeldBy(players: Player[]) {
  const [wallets, escrow] = await Promise.all([
    admin.from('wallets').select('bonus_balance, cash_balance').in('user_id', ids(players)),
    admin.from('escrow').select('amount').eq('status', 'held').in('user_id', ids(players)),
  ])
  return (
    rows<{ bonus_balance: number; cash_balance: number }>(wallets).reduce((sum, w) => sum + w.bonus_balance + w.cash_balance, 0) +
    rows<{ amount: number }>(escrow).reduce((sum, e) => sum + e.amount, 0)
  )
}
