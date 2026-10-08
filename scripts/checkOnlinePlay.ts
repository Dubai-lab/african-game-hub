// Plays real games on the hosted project through the deployed Edge Functions, as two signed-in
// players, including the things a cheating client would try. Usage: npm run online:check
// Cleans up the test matches afterwards. Exits with code 1 if anything fails.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { requireEnv, runSql } from './lib/managementApi.ts'
import { ensureTestAccounts, resetTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from './lib/testAccounts.ts'

const url = requireEnv('VITE_SUPABASE_URL')
const anonKey = requireEnv('VITE_SUPABASE_ANON_KEY')
const noSession = { auth: { persistSession: false, autoRefreshToken: false } }

let failures = 0
function report(ok: boolean, label: string, detail?: unknown) {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail !== undefined ? `\n      ${JSON.stringify(detail)}` : ''}`)
}

type Reply = { ok?: boolean; code?: string; status?: string; match_id?: string | null; finished?: boolean; san?: string; clock?: string }
type Player = { name: string; id: string; client: SupabaseClient }

async function player(index: 0 | 1): Promise<Player> {
  const account = TEST_ACCOUNTS[index]
  const client = createClient(url, anonKey, noSession)
  const signIn = await client.auth.signInWithPassword({ email: account.email, password: TEST_PASSWORD })
  if (signIn.error || !signIn.data.user) throw signIn.error ?? new Error('sign-in failed')
  return { name: account.username, id: signIn.data.user.id, client }
}

const moveTimes: number[] = []

async function call(who: Player, fn: string, body: Record<string, unknown>): Promise<Reply> {
  const sentAt = Date.now()
  const { data, error } = await who.client.functions.invoke(fn, { body })
  if (fn === 'chess-make-move' && !error && (data as Reply).ok) moveTimes.push(Date.now() - sentAt)
  if (error) return { ok: false, code: `HTTP:${error.message}` }
  return data as Reply
}

const CHESS = { game_type: 'chess', stake: 0, options: { time_control: '3+2' } }

async function pair(a: Player, b: Player, stake = 0) {
  const first = await call(a, 'core-join-queue', { ...CHESS, stake })
  const second = await call(b, 'core-join-queue', { ...CHESS, stake })
  if (first.status !== 'queued' || second.status !== 'matched' || !second.match_id) {
    throw new Error(`pairing failed: ${JSON.stringify([first, second])}`)
  }
  const seats = await a.client.from('match_players').select('user_id, seat').eq('match_id', second.match_id)
  if (seats.error) throw seats.error
  const white = seats.data.find((s) => s.seat === 'white')!.user_id === a.id ? a : b
  return { matchId: second.match_id, white, black: white === a ? b : a }
}

await ensureTestAccounts()
const one = await player(0)
const two = await player(1)

const cleanup = resetTestAccounts

async function balance(who: Player) {
  const { data, error } = await who.client.from('wallets').select('bonus_balance, cash_balance').single()
  if (error) throw error
  return { bonus: data.bonus_balance as number, cash: data.cash_balance as number }
}

try {
  await cleanup()

  console.log('--- Matchmaking ---')
  const lonely = await call(one, 'core-join-queue', CHESS)
  report(lonely.ok === true && lonely.status === 'queued', 'a lone player is queued', lonely)
  const left = await call(one, 'core-leave-queue', {})
  report(left.ok === true, 'cancelling a search works', left)
  report(
    (await call(one, 'core-join-queue', { ...CHESS, options: { time_control: '0+1' } })).code === 'OPTIONS_NOT_ALLOWED',
    'a time control the game does not offer is refused',
  )
  report((await call(one, 'core-join-queue', { ...CHESS, game_type: 'ludo' })).code === 'GAME_NOT_AVAILABLE', 'a game that is not live is refused')
  const anonymous = await createClient(url, anonKey, noSession).functions.invoke('core-join-queue', { body: CHESS })
  report(anonymous.error !== null, 'a visitor who is not signed in is refused')

  const game = await pair(one, two)
  report(true, `two players are paired (${game.white.name} is White)`)
  const again = await call(one, 'core-join-queue', CHESS)
  report(again.status === 'matched' && again.match_id === game.matchId, 'a player already in a game is sent back to it', again)

  console.log('\n--- Moves ---')
  const mv = (who: Player, uci: string, ply: number) => call(who, 'chess-make-move', { match_id: game.matchId, uci, ply })
  report((await mv(game.black, 'e7e5', 0)).code === 'NOT_YOUR_TURN', 'Black cannot move first')
  report((await mv(game.white, 'e2e5', 0)).code === 'ILLEGAL_MOVE', 'an illegal move is refused (pawn e2 to e5)')
  report((await mv(game.white, 'e1e2', 0)).code === 'ILLEGAL_MOVE', 'an illegal move is refused (king onto its own pawn)')
  report((await mv(game.white, 'f2f3', 3)).code === 'OUT_OF_SYNC', 'a move built on a wrong view of the game is refused')
  const malformed = await call(game.white, 'chess-make-move', { match_id: game.matchId, uci: 'f2f3; drop table', ply: 0 })
  report(malformed.ok === false, 'a malformed move is refused', malformed)

  const started = Date.now()
  const first = await mv(game.white, 'f2f3', 0)
  const latency = Date.now() - started
  report(first.ok === true && first.san === 'f3', `a legal move is accepted (${latency} ms round trip)`, first)
  report((await mv(game.white, 'g2g4', 1)).code === 'NOT_YOUR_TURN', 'White cannot move twice in a row')
  report((await mv(game.black, 'e7e5', 1)).ok === true, 'Black replies')
  report((await mv(game.white, 'g2g4', 2)).ok === true, 'White plays on')
  const mate = await mv(game.black, 'd8h4', 3)
  report(mate.ok === true && mate.san === 'Qh4#' && mate.finished === true, 'checkmate is recognised by the server', mate)

  const result = await one.client.from('matches').select('status, result, end_reason, winner_id').eq('id', game.matchId).single()
  report(
    result.data?.status === 'finished' && result.data.result === 'win' && result.data.end_reason === 'checkmate' && result.data.winner_id === game.black.id,
    'the match is recorded as a win for Black by checkmate',
    result.data,
  )
  report((await mv(game.white, 'e2e4', 4)).code === 'GAME_OVER', 'no move is accepted after the game has ended')
  const record = await one.client.from('chess_games').select('pgn').eq('match_id', game.matchId).single()
  report(record.data?.pgn === '1. f3 e5 2. g4 Qh4#', 'the game record is stored', record.data)

  console.log('\n--- Draws, resignation, and the clock ---')
  const second = await pair(two, one)
  const mv2 = (who: Player, uci: string, ply: number) => call(who, 'chess-make-move', { match_id: second.matchId, uci, ply })
  const act = (who: Player, action: string) => call(who, 'chess-game-action', { match_id: second.matchId, action })
  await mv2(second.white, 'e2e4', 0)
  await mv2(second.black, 'e7e5', 1)
  report((await act(second.black, 'accept_draw')).code === 'NO_OFFER', 'a draw cannot be accepted when none was offered')
  report((await act(second.white, 'claim')).clock === 'none', 'a false claim that time is up changes nothing')
  report((await act(second.white, 'offer_draw')).ok === true, 'White offers a draw')
  report((await act(second.white, 'accept_draw')).code === 'NO_OFFER', 'a player cannot accept their own offer')
  report((await act(second.black, 'accept_draw')).ok === true, 'Black accepts')
  const drawn = await one.client.from('matches').select('status, result, end_reason').eq('id', second.matchId).single()
  report(drawn.data?.result === 'draw' && drawn.data.end_reason === 'agreement', 'the match is recorded as a draw by agreement', drawn.data)

  const third = await pair(one, two)
  const quit = await call(third.white, 'chess-game-action', { match_id: third.matchId, action: 'resign' })
  const called = await one.client.from('matches').select('status').eq('id', third.matchId).single()
  report(quit.ok === true && called.data?.status === 'aborted', 'leaving before both have moved calls the game off with no result')

  console.log('\n--- Stakes ---')
  await cleanup()
  report((await call(one, 'core-join-queue', { ...CHESS, stake: 5000 })).code === 'STAKE_NOT_ALLOWED', 'a stake the game does not offer is refused')
  const waiting = await call(one, 'core-join-queue', { ...CHESS, stake: 100 })
  const stillFull = await balance(one)
  report(waiting.status === 'queued' && stillFull.bonus === 1000, 'waiting for a staked match costs nothing', [waiting, stillFull])
  await call(one, 'core-leave-queue', {})

  const bet = await pair(one, two, 100)
  const [heldOne, heldTwo] = [await balance(one), await balance(two)]
  report(heldOne.bonus === 900 && heldTwo.bonus === 900, 'both stakes are taken the moment the match is made (1,000 -> 900 each)', [heldOne, heldTwo])
  const held = await one.client.from('escrow').select('user_id, amount, status').eq('match_id', bet.matchId)
  report(
    held.data?.length === 1 && held.data[0]!.user_id === one.id && held.data[0]!.status === 'held',
    'a player sees their own stake held in escrow, and not the stake of their opponent',
    held.data,
  )

  const bm = (who: Player, uci: string, ply: number) => call(who, 'chess-make-move', { match_id: bet.matchId, uci, ply })
  await bm(bet.white, 'f2f3', 0)
  await bm(bet.black, 'e7e5', 1)
  await bm(bet.white, 'g2g4', 2)
  const win = await bm(bet.black, 'd8h4', 3)
  report(win.finished === true, 'the staked game ends in checkmate')
  const [wonBy, lostBy] = [await balance(bet.black), await balance(bet.white)]
  report(wonBy.bonus === 1080 && lostBy.bonus === 900, 'the winner is paid the pot less the 10% rake (1,080); the loser keeps 900', [wonBy, lostBy])
  const seats = await one.client.from('match_players').select('user_id, tokens_change, rating_before, rating_after').eq('match_id', bet.matchId)
  const winnerSeat = seats.data?.find((p) => p.user_id === bet.black.id)
  const loserSeat = seats.data?.find((p) => p.user_id === bet.white.id)
  report(winnerSeat?.tokens_change === 80 && loserSeat?.tokens_change === -100, 'the match records +80 and -100 tokens', seats.data)
  report(winnerSeat?.rating_after === 1220 && loserSeat?.rating_after === 1180, 'ratings moved: 1200 -> 1220 and 1200 -> 1180', seats.data)
  const books = await runSql<{ amount: number; settled: boolean }>(
    `select r.amount::int as amount, m.settled from public.platform_revenue r join public.matches m on m.id = r.match_id where r.match_id = '${bet.matchId}'`,
  )
  report(books.length === 1 && books[0]!.amount === 20 && books[0]!.settled, 'the platform recorded 20 tokens of rake, once', books)
  const history = await bet.black.client.from('ledger_entries').select('entry_type, amount').eq('match_id', bet.matchId).order('id')
  report(
    JSON.stringify(history.data) === JSON.stringify([{ entry_type: 'stake', amount: -100 }, { entry_type: 'win_payout', amount: 180 }]),
    'the winner sees the stake and the payout in their transaction history',
    history.data,
  )

  const tie = await pair(two, one, 250)
  const tm = (who: Player, uci: string, ply: number) => call(who, 'chess-make-move', { match_id: tie.matchId, uci, ply })
  await tm(tie.white, 'e2e4', 0)
  await tm(tie.black, 'e7e5', 1)
  await call(tie.white, 'chess-game-action', { match_id: tie.matchId, action: 'offer_draw' })
  await call(tie.black, 'chess-game-action', { match_id: tie.matchId, action: 'accept_draw' })
  const [afterDrawWinner, afterDrawLoser] = [await balance(bet.black), await balance(bet.white)]
  report(
    afterDrawWinner.bonus === 1080 && afterDrawLoser.bonus === 900,
    'a drawn staked game returns both stakes in full, with no rake',
    [afterDrawWinner, afterDrawLoser],
  )
  report((await call(bet.white, 'core-join-queue', { ...CHESS, stake: 1000 })).code === 'INSUFFICIENT_BALANCE', 'a player holding 900 tokens cannot stake 1,000')

  console.log('\n--- Going around the functions ---')
  const direct = await one.client.rpc('chess_apply_move', {
    p_match_id: game.matchId, p_user_id: one.id, p_expected_ply: 0, p_san: 'e4', p_uci: 'e2e4',
    p_fen_after: 'x', p_end_reason: 'checkmate', p_winner: 'w',
  })
  report(direct.error !== null, 'a player cannot call the database move function directly')
  const queueDirect = await one.client.rpc('join_match_queue', {
    p_user_id: two.id, p_game_type: 'chess', p_stake: 0, p_options: {}, p_rating_pool: 'blitz',
  })
  report(queueDirect.error !== null, 'a player cannot queue someone else through the database')
  const tamper = await one.client.from('chess_games').update({ fen: '8/8/8/8/8/8/8/8 w - - 0 1' }).eq('match_id', game.matchId).select()
  report(tamper.error !== null, 'a player cannot edit the stored position')

  console.log('\n--- Background sweep ---')
  const cron = await runSql<{ jobname: string; schedule: string; active: boolean }>(
    `select jobname, schedule, active from cron.job where jobname = 'agh-sweep'`,
  )
  report(cron.length === 1 && cron[0]!.active, 'the timeout sweep is scheduled', cron)
  await new Promise((resolve) => setTimeout(resolve, 12_000))
  const runs = await runSql<{ status: string }>(
    `select d.status from cron.job_run_details d join cron.job j on j.jobid = d.jobid
      where j.jobname = 'agh-sweep' order by d.start_time desc limit 3`,
  )
  report(runs.length > 0 && runs.every((r) => r.status === 'succeeded'), 'and its recent runs succeeded', runs)

  console.log('\n--- Speed ---')
  const sorted = [...moveTimes].sort((a, b) => a - b)
  console.log(`      accepted moves, round trip from this machine (ms): ${moveTimes.join(', ')}  | median ${sorted[Math.floor(sorted.length / 2)]}`)

  const integrity = await runSql(`select * from public.verify_ledger_integrity()`)
  report(integrity.length === 0, 'ledger integrity: the books balance', integrity)
} finally {
  await cleanup()
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
