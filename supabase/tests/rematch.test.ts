import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './testDb'

// Rematch offers, called the way the core-rematch Edge Function calls them.

let db: TestDb
const users: Record<string, string> = {}
type Json = Record<string, unknown>
let n = 0

async function rematch(user: string, matchId: string, action: string): Promise<Json> {
  return (await db.rows<{ r: Json }>(`select public.rematch($1, $2, $3) as r`, [users[user], matchId, action]))[0]!.r
}
const wallet = async (user: string) =>
  (await db.rows<{ bonus: number }>(`select bonus_balance::int as bonus from public.wallets where user_id = $1`, [users[user]]))[0]!.bonus
const seat = async (matchId: string, user: string) =>
  (await db.rows<{ seat: string }>(`select seat from public.match_players where match_id = $1 and user_id = $2`, [matchId, users[user]]))[0]!.seat

/** Two fresh players and a finished staked game between them (a won it). */
async function finishedGame(stake = 100) {
  const a = `a${++n}`
  const b = `b${n}`
  for (const name of [a, b]) users[name] = await db.createUser(`${name}@example.com`, { username: name, country_code: 'GH', age_confirmed: true })
  await db.pg.query(`select public.join_match_queue($1, 'chess', $2, '{"time_control":"3+2"}', 'blitz')`, [users[a], stake])
  const [row] = await db.rows<{ r: Json }>(`select public.join_match_queue($1, 'chess', $2, '{"time_control":"3+2"}', 'blitz') as r`, [users[b], stake])
  const matchId = row!.r.match_id as string
  await db.pg.query(`select private.finish_match($1, 'win', $2, 'resignation')`, [matchId, users[a]])
  return { a, b, matchId }
}

beforeAll(async () => {
  db = await createTestDb()
  users.outsider = await db.createUser('outsider@example.com', { username: 'outsider', country_code: 'GH', age_confirmed: true })
}, 120_000)

afterEach(async () => {
  await db.pg.exec(`select private.finish_match(id, 'aborted', null, 'test_cleanup') from public.matches where status = 'active'`)
  expect(await db.integrityProblems()).toEqual([])
})

afterAll(async () => {
  await db.close()
})

describe('rematch', () => {
  it('offer, then accept: a new game on the same terms with the seats swapped and both stakes held', async () => {
    const { a, b, matchId } = await finishedGame(100)
    expect(await wallet(a)).toBe(1080)
    expect(await wallet(b)).toBe(900)

    expect(await rematch(a, matchId, 'offer')).toEqual({ status: 'pending' })
    // Asking twice changes nothing, and nothing has been charged yet.
    expect(await rematch(a, matchId, 'offer')).toEqual({ status: 'pending' })
    expect(await wallet(a)).toBe(1080)
    // The one who asked cannot accept for the other player.
    expect(await rematch(a, matchId, 'accept')).toEqual({ status: 'error', code: 'NO_REMATCH_OFFER' })

    const reply = await rematch(b, matchId, 'accept')
    expect(reply.status).toBe('matched')
    const next = reply.match_id as string
    const [m] = await db.rows(`select game_type, stake_amount::int as stake, options, rating_pool, status from public.matches where id = $1`, [next])
    expect(m).toEqual({ game_type: 'chess', stake: 100, options: { time_control: '3+2' }, rating_pool: 'blitz', status: 'active' })
    expect(await seat(next, a)).toBe(await seat(matchId, b))
    expect(await seat(next, b)).toBe(await seat(matchId, a))
    expect(await wallet(a)).toBe(980)
    expect(await wallet(b)).toBe(800)
    expect(await db.rows(`select 1 from public.chess_games where match_id = $1`, [next])).toHaveLength(1)

    // Any further request about the old game points at the new one; no third game appears.
    expect(await rematch(a, matchId, 'offer')).toEqual({ status: 'matched', match_id: next })
    expect(await rematch(b, matchId, 'accept')).toEqual({ status: 'matched', match_id: next })
    expect((await db.rows(`select 1 from public.matches where status = 'active'`)).length).toBe(1)
  })

  it('both players asking at once is a yes', async () => {
    const { a, b, matchId } = await finishedGame(0)
    expect(await rematch(a, matchId, 'offer')).toEqual({ status: 'pending' })
    expect((await rematch(b, matchId, 'offer')).status).toBe('matched')
  })

  it('declining ends it: the same player cannot keep asking, but the other may ask back', async () => {
    const { a, b, matchId } = await finishedGame(0)
    await rematch(a, matchId, 'offer')
    expect(await rematch(b, matchId, 'decline')).toEqual({ status: 'declined' })
    expect(await rematch(a, matchId, 'offer')).toEqual({ status: 'error', code: 'REMATCH_DECLINED' })
    expect(await rematch(b, matchId, 'accept')).toEqual({ status: 'error', code: 'NO_REMATCH_OFFER' })
    expect(await rematch(b, matchId, 'offer')).toEqual({ status: 'pending' })
    expect((await rematch(a, matchId, 'accept')).status).toBe('matched')
  })

  it('an offer can be taken back, and an unanswered one lapses', async () => {
    const { a, b, matchId } = await finishedGame(0)
    await rematch(a, matchId, 'offer')
    expect(await rematch(a, matchId, 'cancel')).toEqual({ status: 'cancelled' })
    expect(await rematch(b, matchId, 'accept')).toEqual({ status: 'error', code: 'NO_REMATCH_OFFER' })

    await rematch(a, matchId, 'offer')
    await db.pg.query(`update public.rematch_offers set created_at = now() - interval '3 minutes' where match_id = $1`, [matchId])
    expect(await rematch(b, matchId, 'accept')).toEqual({ status: 'error', code: 'NO_REMATCH_OFFER' })
    expect(await rematch(b, matchId, 'decline')).toEqual({ status: 'error', code: 'NO_REMATCH_OFFER' })
  })

  it('refuses outsiders, games still in play, and games that ended long ago', async () => {
    const { a, b, matchId } = await finishedGame(0)
    expect(await rematch('outsider', matchId, 'offer')).toEqual({ status: 'error', code: 'NOT_A_PLAYER' })
    expect(await rematch(a, matchId, 'explode')).toEqual({ status: 'error', code: 'BAD_REQUEST' })

    await db.pg.query(`update public.matches set finished_at = now() - interval '11 minutes' where id = $1`, [matchId])
    expect(await rematch(a, matchId, 'offer')).toEqual({ status: 'error', code: 'REMATCH_CLOSED' })

    await db.pg.query(`select public.join_match_queue($1, 'chess', 0, '{"time_control":"3+2"}', 'blitz')`, [users[a]])
    const [row] = await db.rows<{ r: Json }>(`select public.join_match_queue($1, 'chess', 0, '{"time_control":"3+2"}', 'blitz') as r`, [users[b]])
    expect(await rematch(a, row!.r.match_id as string, 'offer')).toEqual({ status: 'error', code: 'REMATCH_CLOSED' })
  })

  it('nobody is charged when either player cannot pay or has moved on', async () => {
    const { a, b, matchId } = await finishedGame(500)
    // b lost 500 and now holds 500; take most of it away.
    await db.pg.query(`select private.apply_ledger_entry($1, -450, 'bonus', 'adjustment')`, [users[b]])
    expect(await rematch(b, matchId, 'offer')).toEqual({ status: 'error', code: 'INSUFFICIENT_BALANCE' })
    await rematch(a, matchId, 'offer')
    expect(await rematch(b, matchId, 'accept')).toEqual({ status: 'error', code: 'INSUFFICIENT_BALANCE' })
    expect(await wallet(a)).toBe(1400)
    expect(await wallet(b)).toBe(50)
    expect(await db.rows(`select 1 from public.matches where status = 'active'`)).toEqual([])

    // The one who asked starts another game before the answer comes.
    const second = await finishedGame(0)
    await rematch(second.a, second.matchId, 'offer')
    await db.pg.query(`select public.join_match_queue($1, 'chess', 0, '{"time_control":"3+2"}', 'blitz')`, [users[second.a]])
    await db.pg.query(`select public.join_match_queue($1, 'chess', 0, '{"time_control":"3+2"}', 'blitz')`, [users.outsider])
    expect(await rematch(second.b, second.matchId, 'accept')).toEqual({ status: 'error', code: 'OPPONENT_UNAVAILABLE' })
    expect(await rematch(second.a, second.matchId, 'offer')).toEqual({ status: 'error', code: 'ALREADY_PLAYING' })
  })

  it('a banned player and a blocked pair get no rematch', async () => {
    const { a, b, matchId } = await finishedGame(0)
    await db.pg.query(`update public.profile_private set is_banned = true where user_id = $1`, [users[a]])
    expect(await rematch(a, matchId, 'offer')).toEqual({ status: 'error', code: 'BANNED' })
    await db.pg.query(`update public.profile_private set is_banned = false where user_id = $1`, [users[a]])
    await db.pg.query(`insert into public.blocks (blocker_id, blocked_id) values ($1, $2)`, [users[b], users[a]])
    expect(await rematch(a, matchId, 'offer')).toEqual({ status: 'error', code: 'CANNOT_CONTACT' })
  })

  it('only the two players can see the offer, and no player can write one', async () => {
    const { a, matchId } = await finishedGame(0)
    await rematch(a, matchId, 'offer')
    const read = (user: string) => db.as('authenticated', users[user]!, () => db.rows(`select status from public.rematch_offers where match_id = $1`, [matchId]))
    expect(await read(a)).toEqual([{ status: 'pending' }])
    expect(await read('outsider')).toEqual([])
    await expect(
      db.as('authenticated', users[a]!, () => db.rows(`update public.rematch_offers set status = 'accepted' where match_id = $1 returning 1`, [matchId])),
    ).rejects.toThrow()
    await expect(db.as('authenticated', users[a]!, () => db.rows(`select public.rematch($1, $2, 'offer')`, [users[a], matchId]))).rejects.toThrow(/permission denied/)
  })
})
