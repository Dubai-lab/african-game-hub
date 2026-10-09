import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './testDb'

// Challenges ("play a friend") and tournaments: who may start what, where the tokens are at
// every step, and that nothing is ever paid twice. The books must balance after every test.

let db: TestDb
const users: Record<string, string> = {}
type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
let n = 0
const CHESS = JSON.stringify({ time_control: '5+0' })

const call = async (sql: string, params: unknown[] = []): Promise<Json> => (await db.rows<{ r: Json }>(`select ${sql} as r`, params))[0]!.r
const wallet = async (user: string) =>
  (await db.rows<{ bonus: number; cash: number }>(`select bonus_balance::int as bonus, cash_balance::int as cash from public.wallets where user_id = $1`, [users[user]]))[0]!
const one = async <T = Json>(sql: string, params: unknown[] = []) => (await db.rows<T>(sql, params))[0]!

async function player(prefix = 'plr'): Promise<string> {
  const name = `${prefix}${++n}`
  users[name] = await db.createUser(`${name}@example.com`, { username: name, country_code: 'GH', age_confirmed: true })
  return name
}
async function friends(a: string, b: string) {
  await db.pg.query(`insert into public.friendships (requester_id, addressee_id, status, responded_at) values ($1, $2, 'accepted', now())`, [users[a], users[b]])
}
const finish = (matchId: string, winner: string | null) =>
  db.pg.query(`select private.finish_match($1, $2, $3, 'test')`, [matchId, winner ? 'win' : 'draw', winner ? users[winner] : null])

beforeAll(async () => {
  db = await createTestDb()
}, 120_000)

afterEach(async () => {
  await db.pg.exec(`select private.finish_match(id, 'aborted', null, 'test_cleanup') from public.matches where status = 'active'`)
  expect(await db.integrityProblems()).toEqual([])
})

afterAll(async () => {
  await db.close()
})

describe('challenges', () => {
  const create = (from: string, to: string | null, stake = 0) =>
    call(`public.challenge_create($1, 'chess', $2, $3, $4, 'blitz', 2)`, [users[from], to, stake, CHESS])
  const respond = (who: string, id: string, action: string) => call(`public.challenge_respond($1, $2, $3)`, [users[who], id, action])

  it('a friend can be invited by name; a stranger cannot; nobody can invite themselves', async () => {
    const a = await player()
    const b = await player()
    const stranger = await player()
    await friends(a, b)
    expect(await create(a, stranger)).toEqual({ status: 'error', code: 'NOT_A_FRIEND' })
    expect(await create(a, 'no-such-player')).toEqual({ status: 'error', code: 'NOT_A_FRIEND' })
    expect(await create(a, a)).toEqual({ status: 'error', code: 'NOT_A_FRIEND' })
    expect(await create(a, b)).toMatchObject({ status: 'pending' })
    // A stake that is not on offer, or a game for more than two, is refused.
    expect(await create(a, b, 123)).toEqual({ status: 'error', code: 'BAD_STAKE' })
    expect(await call(`public.challenge_create($1, 'ludo', null, 0, '{}', 'default', 4)`, [users[a]])).toEqual({ status: 'error', code: 'GAME_NOT_AVAILABLE' })
  })

  it('accepting starts a normal staked match: both stakes are held, and the winner is paid once', async () => {
    const a = await player()
    const b = await player()
    await friends(a, b)
    const { id } = await create(a, b, 100)
    // Nothing leaves either wallet until the invitation is accepted.
    expect((await wallet(a)).bonus).toBe(1000)
    // Only the invited player may answer, and the inviter cannot accept their own invitation.
    const nosy = await player()
    expect(await respond(nosy, id, 'accept')).toEqual({ status: 'error', code: 'NOT_ALLOWED' })
    expect(await respond(a, id, 'accept')).toEqual({ status: 'error', code: 'NOT_ALLOWED' })

    const accepted = await respond(b, id, 'accept')
    expect(accepted.status).toBe('matched')
    expect((await wallet(a)).bonus).toBe(900)
    expect((await wallet(b)).bonus).toBe(900)
    // A second tap gets the same game, not another one.
    expect(await respond(b, id, 'accept')).toEqual(accepted)
    expect((await one<{ n: number }>(`select count(*)::int as n from public.matches where status = 'active'`)).n).toBe(1)
    const seats = await db.rows<{ seat: string }>(`select seat from public.match_players where match_id = $1 order by seat`, [accepted.match_id])
    expect(seats.map((s) => s.seat).sort()).toEqual(['black', 'white'])

    await finish(accepted.match_id, a)
    expect((await wallet(a)).bonus + (await wallet(a)).cash).toBe(1080)
    expect((await wallet(b)).bonus).toBe(900)
  })

  it('a link invitation can be accepted by anyone but its maker, once', async () => {
    const a = await player()
    const b = await player()
    const c = await player()
    const { id } = await create(a, null, 0)
    const first = await respond(b, id, 'accept')
    expect(first.status).toBe('matched')
    expect(await respond(c, id, 'accept')).toEqual({ status: 'error', code: 'CHALLENGE_CLOSED' })
    await finish(first.match_id, null)
  })

  it('declining, cancelling, a newer invitation, time running out, and an empty wallet all close it', async () => {
    const a = await player()
    const b = await player()
    await friends(a, b)
    const first = await create(a, b)
    expect(await respond(b, first.id, 'decline')).toEqual({ status: 'declined' })
    expect(await respond(b, first.id, 'accept')).toEqual({ status: 'error', code: 'CHALLENGE_CLOSED' })

    const second = await create(a, b)
    expect(await respond(b, second.id, 'cancel')).toEqual({ status: 'error', code: 'NOT_ALLOWED' })
    // Inviting again withdraws the invitation before it.
    const third = await create(a, null)
    expect((await one<{ status: string }>(`select status from public.challenges where id = $1`, [second.id])).status).toBe('cancelled')
    expect(await respond(a, third.id, 'cancel')).toEqual({ status: 'cancelled' })

    const late = await create(a, b)
    await db.pg.query(`update public.challenges set expires_at = now() - interval '1 second' where id = $1`, [late.id])
    expect(await respond(b, late.id, 'accept')).toEqual({ status: 'error', code: 'CHALLENGE_CLOSED' })

    // The stake must still be there on both sides when the game starts.
    const rich = await create(a, b, 1000)
    await db.pg.query(`select private.apply_ledger_entry($1, -500, 'bonus', 'adjustment')`, [users[b]])
    expect(await respond(b, rich.id, 'accept')).toEqual({ status: 'error', code: 'INSUFFICIENT_BALANCE' })
    await db.pg.query(`select private.apply_ledger_entry($1, -500, 'bonus', 'adjustment')`, [users[a]])
    await db.pg.query(`select private.apply_ledger_entry($1, 500, 'bonus', 'adjustment')`, [users[b]])
    expect(await respond(b, rich.id, 'accept')).toEqual({ status: 'error', code: 'OPPONENT_UNAVAILABLE' })
    expect((await one<{ n: number }>(`select count(*)::int as n from public.matches where status = 'active'`)).n).toBe(0)
  })
})

describe('tournaments', () => {
  const create = (who: string, prize = 0, minutes = 60, startsIn = '0 seconds') =>
    call(`public.tournament_create($1, 'chess', 'Friday Blitz', $2, 'blitz', 2, now() + $3::interval, 'arena', $4, null, $5)`, [users[who], CHESS, startsIn, minutes, prize])
  const join = (who: string, id: string) => call(`public.tournament_join($1, $2)`, [users[who], id])
  const ready = (who: string, id: string, here = true) => call(`public.tournament_ready($1, $2, $3)`, [users[who], id, here])
  const end = async (id: string) => {
    await db.pg.query(`update public.tournaments set starts_at = now() - interval '1 hour', ends_at = now() - interval '1 second' where id = $1`, [id])
    await db.pg.exec(`select private.tournaments_tick()`)
  }
  const table = (id: string) =>
    db.rows<{ user_id: string; points: number; games: number; place: number | null; prize: number }>(
      `select user_id, points, games, place, prize::int as prize from public.tournament_players where tournament_id = $1 order by place nulls last`,
      [id],
    )
  /** Pairs two waiting players and plays their game to the given result. */
  async function game(id: string, a: string, b: string, winner: string | null) {
    await ready(a, id)
    const paired = await ready(b, id)
    expect(paired.status).toBe('playing')
    await finish(paired.match_id, winner)
    return paired.match_id as string
  }

  it('the prize leaves the creator’s wallet at once and is held; bad requests create nothing', async () => {
    const host = await player('host')
    const made = await create(host, 300)
    expect(made.status).toBe('created')
    expect((await wallet(host)).bonus).toBe(700)
    expect(await db.rows(`select amount::int as amount, balance_type, status from public.tournament_prizes where tournament_id = $1`, [made.id])).toEqual([
      { amount: 300, balance_type: 'bonus', status: 'held' },
    ])

    const before = (await one<{ n: number }>(`select count(*)::int as n from public.tournaments`)).n
    expect(await create(host, 5000)).toEqual({ status: 'error', code: 'INSUFFICIENT_BALANCE' })
    expect(await create(host, -5)).toEqual({ status: 'error', code: 'BAD_PRIZE' })
    expect(await create(host, 0, 17)).toEqual({ status: 'error', code: 'BAD_TOURNAMENT_TIME' })
    expect(await call(`public.tournament_create($1, 'chess', 'x', $2, 'blitz', 2, now(), 'arena', 60, null, 0)`, [users[host], CHESS])).toEqual({ status: 'error', code: 'BAD_TOURNAMENT_NAME' })
    expect(await call(`public.tournament_create($1, 'penalty', 'Not yet', '{}', 'default', 2, now(), 'arena', 60, null, 0)`, [users[host]])).toEqual({ status: 'error', code: 'GAME_NOT_AVAILABLE' })
    expect((await one<{ n: number }>(`select count(*)::int as n from public.tournaments`)).n).toBe(before)
    expect((await wallet(host)).bonus).toBe(700)

    // A player runs three at a time at most.
    expect((await create(host)).status).toBe('created')
    expect((await create(host)).status).toBe('created')
    expect(await create(host)).toEqual({ status: 'error', code: 'TOO_MANY_TOURNAMENTS' })
    await db.pg.exec(`update public.tournaments set ends_at = now() - interval '1 second', starts_at = now() - interval '1 hour' where status in ('scheduled', 'running')`)
    await db.pg.exec(`select private.tournaments_tick()`)
    // Nobody played: the prize went back.
    expect((await wallet(host)).bonus).toBe(1000)
  })

  it('cancelled before it starts, the prize goes back in full; only the creator can, and only before the start', async () => {
    const host = await player('host')
    const other = await player()
    const later = await create(host, 400, 60, '1 hour')
    expect((await wallet(host)).bonus).toBe(600)
    expect(await call(`public.tournament_cancel($1, $2)`, [users[other], later.id])).toEqual({ status: 'error', code: 'TOURNAMENT_NOT_CANCELLABLE' })
    expect(await call(`public.tournament_cancel($1, $2)`, [users[host], later.id])).toEqual({ status: 'cancelled' })
    expect(await call(`public.tournament_cancel($1, $2)`, [users[host], later.id])).toEqual({ status: 'error', code: 'TOURNAMENT_NOT_CANCELLABLE' })
    expect((await wallet(host)).bonus).toBe(1000)
    expect(await join(other, later.id)).toEqual({ status: 'error', code: 'TOURNAMENT_OVER' })

    const now = await create(host, 100)
    await join(other, now.id)
    expect(await call(`public.tournament_cancel($1, $2)`, [users[host], now.id])).toEqual({ status: 'error', code: 'TOURNAMENT_NOT_CANCELLABLE' })
    await end(now.id)
    expect((await wallet(host)).bonus).toBe(1000)
  })

  it('players are paired while it runs, score 2 for a win and 1 for a draw, and the top three share the prize 50/30/20', async () => {
    const host = await player('host')
    const [a, b, c, d] = [await player(), await player(), await player(), await player()]
    const { id } = await create(host, 1000)
    expect((await wallet(host)).bonus).toBe(0)
    for (const who of [a, b, c, d]) expect(await join(who, id)).toEqual({ status: 'joined' })
    expect(await ready(host, id)).toEqual({ status: 'error', code: 'NOT_JOINED' })

    // One player waiting has nobody to play; a second arriving is paired with them at once.
    expect(await ready(a, id)).toEqual({ status: 'waiting' })
    const first = await ready(b, id)
    expect(first.status).toBe('playing')
    const match = await one<{ stake: number; tournament_id: string }>(`select stake_amount::int as stake, tournament_id from public.matches where id = $1`, [first.match_id])
    expect(match).toEqual({ stake: 0, tournament_id: id })
    // While their game is on, both are told to go and play it, and are not paired again.
    // (A player busy in some game outside the tournament is only told they are busy.)
    expect(await ready(a, id)).toEqual({ status: 'playing', match_id: first.match_id })
    expect(await ready(c, id)).toEqual({ status: 'waiting' })
    await finish(first.match_id, a)

    await game(id, c, d, null) // draw: c 1, d 1
    await game(id, a, c, a) // a 4
    await game(id, b, d, b) // b 2
    await game(id, b, c, b) // b 4, c 1
    // Stepping away: a player who says they are not ready is not paired.
    expect(await ready(d, id, false)).toEqual({ status: 'paused' })
    expect(await ready(a, id)).toEqual({ status: 'waiting' })
    await ready(a, id, false)

    await end(id)
    const final = await table(id)
    const by = (name: string) => final.find((row) => row.user_id === users[name])!
    // a and b both have 4 points and 2 wins; a played fewer games (2 against 3), so a is first.
    // c and d both have 1 point and no win; d played fewer games, so d is third.
    expect(by(a)).toMatchObject({ points: 4, games: 2, place: 1, prize: 500 })
    expect(by(b)).toMatchObject({ points: 4, games: 3, place: 2, prize: 300 })
    expect(by(d)).toMatchObject({ points: 1, games: 2, place: 3, prize: 200 })
    expect(by(c)).toMatchObject({ points: 1, games: 3, place: 4, prize: 0 })
    expect((await wallet(a)).bonus).toBe(1500)
    expect((await wallet(b)).bonus).toBe(1300)
    expect((await wallet(d)).bonus).toBe(1200)
    expect((await wallet(host)).bonus).toBe(0)
    expect(await one(`select status, settled from public.tournaments where id = $1`, [id])).toEqual({ status: 'finished', settled: true })

    // Settling again pays nothing more, and nobody can be paired in a finished tournament.
    await db.pg.query(`select private.tournament_settle($1)`, [id])
    await db.pg.exec(`select private.tournaments_tick()`)
    expect((await wallet(a)).bonus).toBe(1500)
    expect(await ready(a, id)).toEqual({ status: 'finished' })
    expect(await join(d, id)).toEqual({ status: 'error', code: 'TOURNAMENT_OVER' })
  })

  it('with two placed players the winner takes the third share; an odd prize loses nothing to rounding', async () => {
    const host = await player('host')
    const [a, b] = [await player(), await player()]
    const { id } = await create(host, 333)
    await join(a, id)
    await join(b, id)
    await game(id, a, b, b)
    await end(id)
    // 30% of 333 is 99 (rounded down); the winner gets the other 234.
    expect((await wallet(b)).bonus).toBe(1234)
    expect((await wallet(a)).bonus).toBe(1099)
  })

  it('a prize keeps its kind: bonus tokens are paid out as bonus, cash as cash', async () => {
    const host = await player('host')
    const [a, b] = [await player(), await player()]
    // The host has 1,000 bonus and 600 cash, and puts up 1,400: all the bonus, then 400 cash.
    await db.pg.query(`select private.apply_ledger_entry($1, 600, 'cash', 'adjustment')`, [users[host]])
    const { id } = await create(host, 1400)
    expect(await wallet(host)).toEqual({ bonus: 0, cash: 200 })
    await join(a, id)
    await join(b, id)
    await game(id, a, b, a)
    await end(id)
    expect(await wallet(a)).toEqual({ bonus: 1000 + 700, cash: 280 })
    expect(await wallet(b)).toEqual({ bonus: 1000 + 300, cash: 120 })
  })

  it('a tournament waits for its last game before it ends, and starts no new game after time', async () => {
    const host = await player('host')
    const [a, b, c] = [await player(), await player(), await player()]
    const { id } = await create(host, 100)
    for (const who of [a, b, c]) await join(who, id)
    await ready(a, id)
    const playing = await ready(b, id)
    await db.pg.query(`update public.tournaments set starts_at = now() - interval '1 hour', ends_at = now() - interval '1 second' where id = $1`, [id])
    await db.pg.exec(`select private.tournaments_tick()`)
    // Time is up, but a game is still being played: not settled yet, and nobody new is paired.
    expect(await one(`select status, settled from public.tournaments where id = $1`, [id])).toEqual({ status: 'running', settled: false })
    expect(await ready(c, id)).toEqual({ status: 'waiting' })
    await finish(playing.match_id, b)
    await db.pg.exec(`select private.tournaments_tick()`)
    // Only one game was played, so both of its players are placed and share the prize.
    expect(await one(`select status, settled from public.tournaments where id = $1`, [id])).toEqual({ status: 'finished', settled: true })
    expect((await wallet(b)).bonus).toBe(1070)
    expect((await wallet(a)).bonus).toBe(1030)
  })

  it('a tournament set for later starts on time, and can be joined before it does', async () => {
    const host = await player('host')
    const a = await player()
    const { id } = await create(host, 0, 30, '10 minutes')
    expect(await join(a, id)).toEqual({ status: 'joined' })
    expect(await ready(a, id)).toEqual({ status: 'scheduled' })
    await db.pg.query(`update public.tournaments set starts_at = now() - interval '1 second' where id = $1`, [id])
    await db.pg.exec(`select private.tournaments_tick()`)
    expect((await one<{ status: string }>(`select status from public.tournaments where id = $1`, [id])).status).toBe('running')
    await end(id)
  })
})

describe('tournaments by rounds', () => {
  const create = (who: string, rounds = 3, prize = 0, startsIn = '10 minutes') =>
    call(`public.tournament_create($1, 'chess', 'Five rounds', $2, 'blitz', 2, now() + $3::interval, 'rounds', null, $4, $5)`, [users[who], CHESS, startsIn, rounds, prize])
  const join = (who: string, id: string) => call(`public.tournament_join($1, $2)`, [users[who], id])
  /** The player's app says "I am here" (as it does every few seconds). */
  const here = (who: string, id: string) => call(`public.tournament_ready($1, $2, false)`, [users[who], id])
  const start = async (id: string) => {
    await db.pg.query(`update public.tournaments set starts_at = now() - interval '1 second' where id = $1`, [id])
    await db.pg.exec(`select private.tournaments_tick()`)
  }
  const tick = () => db.pg.exec(`select private.tournaments_tick()`)
  const pairings = (id: string, round: number) =>
    db.rows<{ a: string; b: string | null; match_id: string | null; result: string | null }>(
      `select player_a as a, player_b as b, match_id, result from public.tournament_pairings where tournament_id = $1 and round = $2 order by id`,
      [id, round],
    )
  const state = (id: string) => one<{ status: string; current_round: number; settled: boolean }>(`select status, current_round, settled from public.tournaments where id = $1`, [id])
  const rate = (who: string, rating: number) =>
    db.pg.query(`insert into public.player_ratings (user_id, game_type, pool, rating) values ($1, 'chess', 'blitz', $2)`, [users[who], rating])
  const name = (id: string | null) => Object.keys(users).find((key) => users[key] === id) ?? null
  /** Everyone says they are here, the games of the round start, and each is played to a result. */
  async function playRound(id: string, round: number, players: string[], winnerOf: (a: string, b: string) => string | null) {
    for (const who of players) await here(who, id)
    await tick()
    const games = await pairings(id, round)
    for (const game of games) {
      if (!game.b) continue
      expect(game.match_id).not.toBeNull()
      await finish(game.match_id!, winnerOf(name(game.a)!, name(game.b)!))
    }
    return games
  }

  it('only kinds and lengths on offer can be created; entry closes when round 1 starts', async () => {
    const host = await player('host')
    expect(await create(host, 4)).toEqual({ status: 'error', code: 'BAD_TOURNAMENT_TIME' })
    expect(await call(`public.tournament_create($1, 'chess', 'What kind', $2, 'blitz', 2, now(), 'knockout', 60, null, 0)`, [users[host], CHESS])).toEqual({ status: 'error', code: 'BAD_TOURNAMENT_TIME' })
    const { id } = await create(host, 3)
    const [a, b, late] = [await player(), await player(), await player()]
    await join(a, id)
    await join(b, id)
    await start(id)
    expect(await state(id)).toMatchObject({ status: 'running', current_round: 1 })
    expect(await join(late, id)).toEqual({ status: 'error', code: 'TOURNAMENT_STARTED' })
    // A player already in it can ask again without harm.
    expect(await join(a, id)).toEqual({ status: 'joined' })
    await db.pg.query(`update public.tournament_pairings set result = 'void', resolved_at = now() where tournament_id = $1 and result is null`, [id])
    await db.pg.query(`update public.tournaments set rounds = current_round where id = $1`, [id])
    await tick()
  })

  it('with fewer than two players at the start there is no tournament, and the prize goes back', async () => {
    const host = await player('host')
    const { id } = await create(host, 3, 200)
    const alone = await player()
    await join(alone, id)
    await start(id)
    expect(await state(id)).toMatchObject({ status: 'finished', settled: true })
    expect((await wallet(host)).bonus).toBe(1000)
  })

  it('round 1 is paired by rating; later rounds by points then rating, never the same opponent twice; the next round waits for every game', async () => {
    const host = await player('host')
    const [p2000, p1800, p1500, p1300] = [await player(), await player(), await player(), await player()]
    await rate(p2000, 2000)
    await rate(p1800, 1800)
    await rate(p1500, 1500)
    await rate(p1300, 1300)
    const all = [p2000, p1800, p1500, p1300]
    const { id } = await create(host, 3, 1000)
    for (const who of all) await join(who, id)
    await db.pg.query(`update public.tournament_players set seen_at = null where tournament_id = $1`, [id])
    await start(id)

    // Round 1: the highest plays the next highest, and so on down.
    let round = await pairings(id, 1)
    expect(round.map((g) => [name(g.a), name(g.b)])).toEqual([[p2000, p1800], [p1500, p1300]])
    // No game starts until both of its players are here.
    expect(round.every((g) => g.match_id === null)).toBe(true)
    await here(p2000, id)
    await tick()
    expect((await pairings(id, 1))[0]!.match_id).toBeNull()
    expect(await here(p1800, id)).toMatchObject({ status: 'playing' })
    expect((await pairings(id, 1))[0]!.match_id).not.toBeNull()
    // The games are part of the tournament and of its round, and free.
    const first = (await pairings(id, 1))[0]!.match_id!
    expect(await one(`select stake_amount::int as stake, tournament_round from public.matches where id = $1`, [first])).toEqual({ stake: 0, tournament_round: 1 })

    // The round is not over until every game is: with one game finished, round 2 has not begun.
    await finish(first, p2000)
    await tick()
    expect((await state(id)).current_round).toBe(1)
    await here(p1500, id)
    const second = await here(p1300, id)
    await finish(second.match_id, p1500)
    for (const who of all) await here(who, id)
    await tick()
    expect((await state(id)).current_round).toBe(2)

    // Round 2: the two winners (2 points each) meet, and the two losers meet.
    round = await pairings(id, 2)
    expect(round.map((g) => [name(g.a), name(g.b)])).toEqual([[p2000, p1500], [p1800, p1300]])
    for (const who of all) await here(who, id)
    await tick()
    for (const game of await pairings(id, 2)) await finish(game.match_id!, name(game.a))
    for (const who of all) await here(who, id)
    await tick()

    // Round 3: 2000 has 4, 1800 has 2, 1500 has 2, 1300 has 0. 2000 has met both of the others
    // on 2 points already, so plays the one player left unmet; nobody meets anyone twice.
    round = await pairings(id, 3)
    expect(round.map((g) => [name(g.a), name(g.b)])).toEqual([[p2000, p1300], [p1800, p1500]])
    for (const who of all) await here(who, id)
    await tick()
    for (const game of await pairings(id, 3)) await finish(game.match_id!, name(game.a))
    await tick()

    // Three rounds were asked for: it is over, and the top three share the prize.
    expect(await state(id)).toMatchObject({ status: 'finished', current_round: 3, settled: true })
    expect((await wallet(p2000)).bonus).toBe(1500)
    expect((await wallet(p1800)).bonus).toBe(1300)
    expect((await wallet(p1500)).bonus).toBe(1200)
    expect((await wallet(p1300)).bonus).toBe(1000)
    expect((await wallet(host)).bonus).toBe(0)
  })

  it('a player who is not there a minute into the round loses the game and is dropped; with an odd number, one player gets a bye', async () => {
    const host = await player('host')
    const [a, b, c] = [await player(), await player(), await player()]
    await rate(a, 1900)
    await rate(b, 1700)
    await rate(c, 1500)
    const { id } = await create(host, 3)
    for (const who of [a, b, c]) await join(who, id)
    await db.pg.query(`update public.tournament_players set seen_at = null where tournament_id = $1`, [id])
    await start(id)
    // Three players: the lowest has no opponent and is given the win.
    let round = await pairings(id, 1)
    expect(round.map((g) => [name(g.a), name(g.b), g.result])).toEqual([[c, null, 'bye'], [a, b, null]])
    expect(await one(`select points, games from public.tournament_players where tournament_id = $1 and user_id = $2`, [id, users[c]])).toEqual({ points: 2, games: 1 })

    // a is here; b never shows up. Nothing is decided before the minute is up...
    await here(a, id)
    await tick()
    expect((await pairings(id, 1))[1]!.result).toBeNull()
    // ...and after it, a has the win and b is out of the rounds that follow.
    await db.pg.query(`update public.tournaments set round_started_at = now() - interval '61 seconds' where id = $1`, [id])
    await here(a, id)
    expect((await pairings(id, 1))[1]!.result).toBe('forfeit_b')
    expect(await one(`select points, wins, dropped from public.tournament_players where tournament_id = $1 and user_id = $2`, [id, users[a]])).toEqual({ points: 2, wins: 1, dropped: false })
    expect(await one(`select points, losses, dropped from public.tournament_players where tournament_id = $1 and user_id = $2`, [id, users[b]])).toEqual({ points: 0, losses: 1, dropped: true })
    expect(await here(b, id)).toEqual({ status: 'dropped' })

    // Round 2 is between the two who are left; there is no third round to pair, because they
    // would have nobody new to meet... but the rounds asked for are still played.
    expect((await state(id)).current_round).toBe(2)
    round = await pairings(id, 2)
    expect(round.map((g) => [name(g.a), name(g.b)])).toEqual([[a, c]])
    await playRound(id, 2, [a, c], () => a)
    await tick()
    await playRound(id, 3, [a, c], () => null)
    await tick()
    expect(await state(id)).toMatchObject({ status: 'finished', settled: true })
    const places = await db.rows<{ user_id: string; place: number }>(`select user_id, place from public.tournament_players where tournament_id = $1 order by place`, [id])
    expect(places.map((row) => name(row.user_id))).toEqual([a, c, b])
  })

  /** Lets the first-move window of a chess game run out, and has the server look at the clock. */
  const neverStarted = async (matchId: string) => {
    await db.pg.query(`update public.chess_games set last_move_at = last_move_at - interval '31 seconds' where match_id = $1`, [matchId])
    await db.pg.query(`select private.chess_check_clock($1)`, [matchId])
  }
  const seatOf = async (matchId: string, seat: string) =>
    (await one<{ user_id: string }>(`select user_id from public.match_players where match_id = $1 and seat = $2`, [matchId, seat])).user_id
  const result = (matchId: string) =>
    one<{ status: string; result: string; end_reason: string; winner_id: string | null }>(`select status, result, end_reason, winner_id from public.matches where id = $1`, [matchId])
  const points = async (id: string, userId: string) =>
    (await one<{ points: number; games: number; wins: number; losses: number }>(`select points, games, wins, losses from public.tournament_players where tournament_id = $1 and user_id = $2`, [id, userId]))

  it('a player who never makes their first move loses the game, and the player who was there gets the win', async () => {
    const host = await player('host')
    const [a, b] = [await player(), await player()]
    const { id } = await create(host, 3)
    await join(a, id)
    await join(b, id)
    await start(id)
    await here(a, id)
    const game = await here(b, id)
    const white = await seatOf(game.match_id, 'white')
    const black = await seatOf(game.match_id, 'black')

    // White never plays the first move.
    await neverStarted(game.match_id)
    expect(await result(game.match_id)).toEqual({ status: 'finished', result: 'win', end_reason: 'no_show', winner_id: black })
    expect(await points(id, black)).toEqual({ points: 2, games: 1, wins: 1, losses: 0 })
    expect(await points(id, white)).toEqual({ points: 0, games: 1, wins: 0, losses: 1 })
    expect((await pairings(id, 1))[0]!.result).toBe('played')
    // It is recorded once: looking at the clock again changes nothing.
    await db.pg.query(`select private.chess_check_clock($1)`, [game.match_id])
    expect(await points(id, black)).toEqual({ points: 2, games: 1, wins: 1, losses: 0 })
  })

  it('when White has moved and Black never answers, it is Black who loses', async () => {
    const host = await player('host')
    const [a, b] = [await player(), await player()]
    const { id } = await create(host, 3)
    await join(a, id)
    await join(b, id)
    await start(id)
    await here(a, id)
    const game = await here(b, id)
    const white = await seatOf(game.match_id, 'white')
    await db.pg.query(`select public.chess_apply_move($1, $2, 0, 'e4', 'e2e4', 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', null, null)`, [game.match_id, white])
    await neverStarted(game.match_id)
    expect(await result(game.match_id)).toMatchObject({ result: 'win', end_reason: 'no_show', winner_id: white })
    expect(await points(id, white)).toMatchObject({ points: 2, wins: 1 })
  })

  it('a game called off any other way still scores nothing, and the round moves on', async () => {
    const host = await player('host')
    const [a, b] = [await player(), await player()]
    const { id } = await create(host, 3)
    await join(a, id)
    await join(b, id)
    await start(id)
    await here(a, id)
    const game = await here(b, id)
    // A player leaves before both have moved.
    await db.pg.query(`select private.finish_match($1, 'aborted', null, 'aborted_by_player')`, [game.match_id])
    expect(await result(game.match_id)).toMatchObject({ status: 'aborted', result: 'aborted' })
    expect((await pairings(id, 1))[0]!.result).toBe('void')
    await here(a, id)
    await here(b, id)
    expect((await state(id)).current_round).toBe(2)
    await db.pg.query(`update public.tournament_pairings set result = 'void', resolved_at = now() where tournament_id = $1 and result is null`, [id])
    await db.pg.query(`update public.tournaments set rounds = current_round where id = $1`, [id])
    await tick()
    // Nobody finished a game, so nobody is placed.
    expect(await state(id)).toMatchObject({ status: 'finished', settled: true })
  })

  it('outside a tournament, a game nobody starts is still called off with no result', async () => {
    const [a, b] = [await player(), await player()]
    await db.pg.query(`select public.join_match_queue($1, 'chess', 0, $2, 'blitz')`, [users[a], CHESS])
    const joined = await call(`public.join_match_queue($1, 'chess', 0, $2, 'blitz')`, [users[b], CHESS])
    await neverStarted(joined.match_id)
    expect(await result(joined.match_id)).toEqual({ status: 'aborted', result: 'aborted', end_reason: 'no_first_move', winner_id: null })
  })
})

describe('watching and chat', () => {
  it('a tournament game can be watched by any signed-in player while it is played; an ordinary game cannot', async () => {
    const host = await player('host')
    const [a, b, watcher] = [await player(), await player(), await player()]
    const made = await call(`public.tournament_create($1, 'chess', 'Watch this', $2, 'blitz', 2, now(), 'arena', 30, null, 0)`, [users[host], CHESS])
    await call(`public.tournament_join($1, $2)`, [users[a], made.id])
    await call(`public.tournament_join($1, $2)`, [users[b], made.id])
    await call(`public.tournament_ready($1, $2, true)`, [users[a], made.id])
    const game = await call(`public.tournament_ready($1, $2, true)`, [users[b], made.id])
    const as = <T>(who: string, sql: string, params: unknown[] = []) => db.as('authenticated', users[who]!, () => db.rows<T>(sql, params))
    expect((await as(watcher, `select 1 from public.matches where id = $1`, [game.match_id])).length).toBe(1)
    expect((await as(watcher, `select 1 from public.match_players where match_id = $1`, [game.match_id])).length).toBe(2)
    expect((await as(watcher, `select 1 from public.chess_games where match_id = $1`, [game.match_id])).length).toBe(1)
    // Watching is reading only.
    await expect(as(watcher, `update public.chess_games set fen = 'x' where match_id = $1 returning 1`, [game.match_id])).rejects.toThrow()
    await finish(game.match_id, a)

    // A game found by ordinary matchmaking stays private to its players while it is played.
    const c = await player()
    const d = await player()
    await db.pg.query(`select public.join_match_queue($1, 'chess', 0, $2, 'blitz')`, [users[c], CHESS])
    const [joined] = await db.rows<{ r: Json }>(`select public.join_match_queue($1, 'chess', 0, $2, 'blitz') as r`, [users[d], CHESS])
    expect(await as(watcher, `select 1 from public.matches where id = $1`, [joined!.r.match_id])).toEqual([])
    expect(await as(watcher, `select 1 from public.chess_games where match_id = $1`, [joined!.r.match_id])).toEqual([])
    await db.pg.exec(`update public.tournaments set starts_at = now() - interval '1 hour', ends_at = now() - interval '1 second' where status in ('scheduled', 'running')`)
    await db.pg.exec(`select private.tournaments_tick()`)
  })

  it('players and the creator can write in a tournament’s chat; everyone signed in can read; not too fast, not too long', async () => {
    const host = await player('host')
    const [a, outsider] = [await player(), await player()]
    const made = await call(`public.tournament_create($1, 'chess', 'Talk here', $2, 'blitz', 2, now(), 'arena', 30, null, 0)`, [users[host], CHESS])
    await call(`public.tournament_join($1, $2)`, [users[a], made.id])
    const say = async (who: string, body: string) =>
      (await db.as('authenticated', users[who]!, () => db.rows<{ r: Json }>(`select public.send_tournament_message($1, $2) as r`, [made.id, body])))[0]!.r
    expect(await say(a, '  good luck   everyone ')).toMatchObject({ ok: true })
    expect(await say(a, 'again at once')).toEqual({ ok: false, code: 'TOO_FAST' })
    expect(await say(host, 'welcome')).toMatchObject({ ok: true })
    expect(await say(outsider, 'let me in')).toEqual({ ok: false, code: 'NOT_JOINED' })
    await db.pg.exec(`update public.tournament_messages set created_at = created_at - interval '5 seconds'`)
    expect(await say(a, '')).toEqual({ ok: false, code: 'BAD_MESSAGE' })
    expect(await say(a, 'x'.repeat(301))).toEqual({ ok: false, code: 'BAD_MESSAGE' })
    const read = await db.as('authenticated', users[outsider]!, () => db.rows<{ body: string }>(`select body from public.tournament_messages where tournament_id = $1 order by id`, [made.id]))
    expect(read.map((row) => row.body)).toEqual(['good luck everyone', 'welcome'])
    // Nobody writes to the table itself.
    await expect(db.as('authenticated', users[a]!, () => db.rows(`insert into public.tournament_messages (tournament_id, sender_id, body) values ($1, $2, 'direct')`, [made.id, users[host]]))).rejects.toThrow()
    await db.pg.exec(`update public.tournaments set starts_at = now() - interval '1 hour', ends_at = now() - interval '1 second' where status in ('scheduled', 'running')`)
    await db.pg.exec(`select private.tournaments_tick()`)
  })
})

describe('access', () => {
  it('players read tournaments and their own invitations; nobody writes them or calls the server functions directly', async () => {
    const host = await player('host')
    const a = await player()
    const b = await player()
    const made = await call(`public.tournament_create($1, 'chess', 'Open to read', $2, 'blitz', 2, now(), 'arena', 30, null, 50)`, [users[host], CHESS])
    const invite = await call(`public.challenge_create($1, 'chess', null, 0, $2, 'blitz', 2)`, [users[a], CHESS])
    await friends(a, b)
    const direct = await call(`public.challenge_create($1, 'chess', $2, 0, $3, 'blitz', 2)`, [users[host], null, CHESS])

    const as = <T>(who: string, sql: string, params: unknown[] = []) => db.as('authenticated', users[who]!, () => db.rows<T>(sql, params))
    expect(await as(a, `select name from public.tournaments where id = $1`, [made.id])).toEqual([{ name: 'Open to read' }])
    // The held prize is the creator's business only.
    expect(await as(a, `select 1 from public.tournament_prizes where tournament_id = $1`, [made.id])).toEqual([])
    expect((await as(host, `select 1 from public.tournament_prizes where tournament_id = $1`, [made.id])).length).toBe(1)
    expect((await as(b, `select 1 from public.challenges where id = $1`, [invite.id])).length).toBe(1)
    expect((await as(b, `select 1 from public.challenges where id = $1`, [direct.id])).length).toBe(1)

    await expect(as(a, `update public.tournaments set prize_amount = 999999 where id = $1 returning 1`, [made.id])).rejects.toThrow()
    await expect(as(a, `insert into public.tournament_players (tournament_id, user_id, points) values ($1, $2, 99)`, [made.id, users[a]])).rejects.toThrow()
    await expect(as(a, `update public.challenges set stake_amount = 0 where id = $1 returning 1`, [invite.id])).rejects.toThrow()
    await expect(as(a, `select public.tournament_join($1, $2)`, [users[a], made.id])).rejects.toThrow(/permission denied/)
    await expect(as(a, `select public.tournament_ready($1, $2, true)`, [users[a], made.id])).rejects.toThrow(/permission denied/)
    await expect(as(a, `select public.tournament_create($1, 'chess', 'Mine', $2, 'blitz', 2, now(), 'arena', 30, null, 0)`, [users[a], CHESS])).rejects.toThrow(/permission denied/)
    await expect(as(a, `select public.challenge_respond($1, $2, 'accept')`, [users[b], invite.id])).rejects.toThrow(/permission denied/)

    await db.pg.exec(`update public.tournaments set starts_at = now() - interval '1 hour', ends_at = now() - interval '1 second' where status in ('scheduled', 'running')`)
    await db.pg.exec(`select private.tournaments_tick()`)
    await db.pg.exec(`update public.challenges set status = 'cancelled', responded_at = now() where status = 'pending'`)
  })
})
