import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { act, type CheckUpState, chooseAction, DECK, isPlain, isSound, leave, type Played, timeout } from '../functions/_shared/checkup'
import { createTestDb, type TestDb } from './testDb'

// Check Up in the database: the deal, who may see which cards, recording a position only on top
// of the one it was worked out from, and how every ending reaches the core and the wallets.
// The rules themselves are tested in src/games/checkup/rules.test.ts; here each request is
// worked out the way the checkup-action function does it (read the whole game, apply the
// rules, record the result).

let db: TestDb
const users: Record<string, string> = {}
type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
let n = 0

type Context = { status: string; seat: string | null; late: boolean; state: CheckUpState }
const context = async (matchId: string, user: string) =>
  (await db.rows<{ r: Context | null }>(`select public.checkup_context($1, $2) as r`, [matchId, users[user]]))[0]!.r
const store = async (matchId: string, expected: number, played: Extract<Played, { ok: true }>): Promise<Json> =>
  (await db.rows<{ r: Json }>(`select public.checkup_store($1, $2, $3, $4) as r`, [matchId, expected, JSON.stringify(played.state), JSON.stringify(played.event)]))[0]!.r
/** What the function does for one request, start to finish. */
async function request(matchId: string, user: string, work: (state: CheckUpState, seat: string) => Played): Promise<Json> {
  const game = (await context(matchId, user))!
  if (game.status !== 'active') return { ok: false, code: 'GAME_OVER' }
  const played = work(game.state, game.seat!)
  if (!played.ok) return played
  return store(matchId, game.state.moveNo, played)
}
const table = async (matchId: string) => (await db.rows<Json>(`select * from public.checkup_games where match_id = $1`, [matchId]))[0]!
const match = async (matchId: string) =>
  (await db.rows<{ status: string; result: string | null; end_reason: string | null; winner_id: string | null; settled: boolean }>(
    `select status, result, end_reason, winner_id, settled from public.matches where id = $1`, [matchId]))[0]!
const wallet = async (user: string) =>
  (await db.rows<{ total: number }>(`select (bonus_balance + cash_balance)::int as total from public.wallets where user_id = $1`, [users[user]]))[0]!.total
const read = <T = Json>(user: string, sql: string, params: unknown[] = []) => db.as('authenticated', users[user]!, () => db.rows<T>(sql, params))

/** A new game between this many players. Returns their names by seat ('1' plays first). */
async function newGame(players = 2, stake = 0) {
  n++
  const names = Array.from({ length: players }, (_, i) => `c${n}p${i + 1}`)
  for (const name of names) users[name] = await db.createUser(`${name}@example.com`, { username: name, country_code: 'NG', age_confirmed: true })
  const options = JSON.stringify({ players })
  let matchId = ''
  for (const name of names) {
    const [row] = await db.rows<{ r: Json }>(`select public.join_match_queue($1, 'checkup', $2, $3, 'default', $4) as r`, [users[name], stake, options, players])
    matchId = (row!.r.match_id as string | undefined) ?? matchId
  }
  const seats = await db.rows<{ user_id: string; seat: string }>(`select user_id, seat from public.match_players where match_id = $1`, [matchId])
  const by: Record<string, string> = {}
  for (const row of seats) by[row.seat] = names.find((name) => users[name] === row.user_id)!
  return { matchId, by, names }
}
/** Puts the stored game into a given position (hands and market by hand), as a real game would have left it. */
async function arrange(matchId: string, hands: Record<string, string[]>, top: string, market: string[], extra: Json = {}) {
  for (const [seat, cards] of Object.entries(hands)) await db.pg.query(`update public.checkup_hands set cards = $3 where match_id = $1 and seat = $2`, [matchId, seat, cards])
  await db.pg.query(`update public.checkup_markets set cards = $2 where match_id = $1`, [matchId, market])
  const fields: Json = { top, counts: JSON.stringify(Object.fromEntries(Object.entries(hands).map(([s, c]) => [s, c.length]))), market_count: market.length, called: null, pending_number: null, pending_count: 0, ...extra }
  await db.pg.query(`update public.checkup_games set ${Object.keys(fields).map((k, i) => `${k} = $${i + 2}`).join(', ')} where match_id = $1`, [matchId, ...Object.values(fields)])
}

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

describe('the pack and the deal', () => {
  it('the database holds the same pack as the rule book', async () => {
    const rows = await db.rows<{ deck: string[] }>(`select private.checkup_deck() as deck`)
    expect(rows[0]!.deck).toEqual([...DECK])
  })

  it('deals six cards each from the whole pack and starts on a plain card, for two, three and four players', async () => {
    for (const players of [2, 3, 4]) {
      const { matchId, by } = await newGame(players)
      const game = (await context(matchId, by['1']!))!
      expect(game.status).toBe('active')
      expect(game.seat).toBe('1')
      expect(game.state.seats).toEqual(['1', '2', '3', '4'].slice(0, players))
      for (const seat of game.state.seats) expect(game.state.hands[seat]).toHaveLength(6)
      expect(game.state.market).toHaveLength(54 - players * 6 - 1)
      expect(isPlain(game.state.top)).toBe(true)
      expect(game.state.turn).toBe('1')
      // Every card of the pack is somewhere, once.
      expect(isSound(game.state)).toBe(true)
      expect([...Object.values(game.state.hands).flat(), ...game.state.market, game.state.top].sort()).toEqual([...DECK].sort())
      // What everyone is shown: how many, never which.
      expect(await table(matchId)).toMatchObject({ counts: Object.fromEntries(game.state.seats.map((s) => [s, 6])), market_count: 54 - players * 6 - 1, top: game.state.top, turn: '1', move_no: 0, phase: 'play' })
    }
  })

  it('shuffles: two games are not dealt the same', async () => {
    const a = (await context((await newGame()).matchId, `c${n}p1`))!.state
    const b = (await context((await newGame()).matchId, `c${n}p1`))!.state
    expect(a.market).not.toEqual(b.market)
  })

  it('refuses a table size that is not on offer', async () => {
    users.odd = await db.createUser('odd@example.com', { username: 'odd1', country_code: 'NG', age_confirmed: true })
    const rows = await db.rows<{ r: Json }>(`select public.join_match_queue($1, 'checkup', 0, '{"players":2}', 'default', 7) as r`, [users.odd]).catch((error: Error): { r: Json }[] => [{ r: { refused: error.message } }])
    expect(rows[0]!.r.match_id).toBeUndefined()
    await db.pg.exec(`delete from public.match_queue`)
  })
})

describe('who may see what', () => {
  it('a player reads their own cards and nobody else’s; nobody reads the market', async () => {
    const { matchId, by } = await newGame(3)
    const mine = await read<{ seat: string; cards: string[] }>(by['1']!, `select seat, cards from public.checkup_hands where match_id = $1`, [matchId])
    expect(mine).toHaveLength(1)
    expect(mine[0]!.seat).toBe('1')
    expect(mine[0]!.cards).toHaveLength(6)
    expect(await read(by['2']!, `select 1 from public.checkup_hands where match_id = $1 and seat = '1'`, [matchId])).toEqual([])
    // The market is not theirs even to ask about.
    await expect(read(by['1']!, `select 1 from public.checkup_markets where match_id = $1`, [matchId])).rejects.toThrow(/permission denied/)
    // The table itself is theirs to see.
    expect(await read(by['2']!, `select top from public.checkup_games where match_id = $1`, [matchId])).toHaveLength(1)

    // Someone who is not in the game sees none of it while it is on.
    users.outsider = await db.createUser(`outsider${n}@example.com`, { username: `outsider${n}`, country_code: 'NG', age_confirmed: true })
    expect(await read('outsider', `select 1 from public.checkup_games where match_id = $1`, [matchId])).toEqual([])
    expect(await read('outsider', `select 1 from public.checkup_hands where match_id = $1`, [matchId])).toEqual([])
  })

  it('no player can write a card, a table or a market, or call the server’s functions', async () => {
    const { matchId, by } = await newGame()
    const player = by['1']!
    for (const sql of [
      `update public.checkup_hands set cards = '{w20}' where match_id = '${matchId}'`,
      `update public.checkup_games set turn = '2' where match_id = '${matchId}'`,
      `update public.checkup_markets set cards = '{}' where match_id = '${matchId}'`,
      `delete from public.checkup_hands where match_id = '${matchId}'`,
    ]) {
      await db.as('authenticated', users[player]!, () => db.pg.query(sql)).catch(() => undefined)
    }
    const game = (await context(matchId, player))!
    expect(game.state.hands['1']).toHaveLength(6)
    expect(game.state.turn).toBe('1')
    expect(game.state.market).toHaveLength(41)
    await expect(read(player, `select public.checkup_context($1, $2)`, [matchId, users[player]])).rejects.toThrow(/permission denied/)
    await expect(read(player, `select public.checkup_store($1, 0, '{}', '{}')`, [matchId])).rejects.toThrow(/permission denied/)
  })

  it('someone who is not in the game is given nothing to judge with', async () => {
    const { matchId } = await newGame()
    users.stranger = await db.createUser(`stranger${n}@example.com`, { username: `stranger${n}`, country_code: 'NG', age_confirmed: true })
    expect(await context(matchId, 'stranger')).toBeNull()
  })
})

describe('recording a position', () => {
  it('a card played is recorded, and everyone is told what happened but not what was drawn', async () => {
    const { matchId, by } = await newGame()
    await arrange(matchId, { '1': ['c3', 't10'], '2': ['x7', 's1'] }, 'c7', ['r1', 'r2', 'r3'])
    expect(await request(matchId, by['1']!, (state, seat) => act(state, seat, { type: 'play', card: 'c3' }))).toMatchObject({ ok: true, move_no: 1 })
    expect(await table(matchId)).toMatchObject({ top: 'c3', turn: '2', counts: { '1': 1, '2': 2 }, move_no: 1, last_event: { seat: '1', kind: 'play', card: 'c3' } })

    // 2 has nothing that goes on a circle 3: to market.
    expect(await request(matchId, by['2']!, (state, seat) => act(state, seat, { type: 'draw' }))).toMatchObject({ ok: true })
    const after = await table(matchId)
    expect(after).toMatchObject({ turn: '1', counts: { '1': 1, '2': 3 }, market_count: 2 })
    expect(after.last_event).toEqual({ seat: '2', kind: 'draw', drew: 1 })
    expect((await context(matchId, by['2']!))!.state.hands['2']).toEqual(['x7', 's1', 'r3'])
  })

  it('a request worked out on an old picture of the game is not recorded', async () => {
    const { matchId, by } = await newGame()
    await arrange(matchId, { '1': ['c3', 'c4'], '2': ['x7', 's1'] }, 'c7', ['r1', 'r2', 'r3'])
    // Two requests from the same position, as when a button is pressed twice.
    const game = (await context(matchId, by['1']!))!
    const first = act(game.state, '1', { type: 'play', card: 'c3' }) as Extract<Played, { ok: true }>
    const second = act(game.state, '1', { type: 'play', card: 'c4' }) as Extract<Played, { ok: true }>
    expect(await store(matchId, 0, first)).toMatchObject({ ok: true })
    expect(await store(matchId, 0, second)).toEqual({ ok: false, code: 'OUT_OF_SYNC' })
    expect((await context(matchId, by['1']!))!.state.hands['1']).toEqual(['c4'])
  })

  it('a position with a card too many is refused outright', async () => {
    const { matchId, by } = await newGame()
    const game = (await context(matchId, by['1']!))!
    const forged = { ...game.state, hands: { ...game.state.hands, '1': [...game.state.hands['1']!, game.state.top] } }
    await expect(store(matchId, 0, { ok: true, state: forged, event: { seat: '1', kind: 'draw', drew: 1 } })).rejects.toThrow(/CHECKUP_BAD_POSITION/)
    expect((await table(matchId)).move_no).toBe(0)
  })
})

describe('how a game ends, and what the wallets show', () => {
  it('the first to finish wins the pot less the fee, and the cards are laid down', async () => {
    const { matchId, by } = await newGame(2, 100)
    const before = { one: await wallet(by['1']!), two: await wallet(by['2']!) }
    await arrange(matchId, { '1': ['c3'], '2': ['x7', 's1'] }, 'c7', ['r1', 'r2', 'r3'])
    expect(await request(matchId, by['1']!, (state, seat) => act(state, seat, { type: 'play', card: 'c3' }))).toMatchObject({ ok: true })
    expect(await match(matchId)).toMatchObject({ status: 'finished', result: 'win', end_reason: 'finished', winner_id: users[by['1']!], settled: true })
    const done = await table(matchId)
    expect(done.phase).toBe('over')
    expect(done.result).toMatchObject({ reason: 'finished', winner: '1', totals: { '1': 0, '2': 8 }, hands: { '1': [], '2': ['x7', 's1'] } })
    // 100 each staked before the game; the winner gets 200 less 10%.
    expect(await wallet(by['1']!)).toBe(before.one + 180)
    expect(await wallet(by['2']!)).toBe(before.two)
    // Nothing more can be recorded.
    expect(await request(matchId, by['2']!, (state, seat) => act(state, seat, { type: 'draw' }))).toEqual({ ok: false, code: 'GAME_OVER' })
  })

  it('when the market is finished the lowest count wins', async () => {
    const { matchId, by } = await newGame(3, 50)
    await arrange(matchId, { '1': ['t10', 'r8'], '2': ['x7', 's3'], '3': ['c1', 'c2'] }, 'c7', ['x13'])
    expect(await request(matchId, by['1']!, (state, seat) => act(state, seat, { type: 'draw' }))).toMatchObject({ ok: true })
    // 1 holds 10 + 16 + 13, 2 holds 10, 3 holds 3.
    expect((await table(matchId)).result).toMatchObject({ reason: 'market', winner: '3', totals: { '1': 39, '2': 10, '3': 3 } })
    expect(await match(matchId)).toMatchObject({ status: 'finished', result: 'win', end_reason: 'market', winner_id: users[by['3']!], settled: true })
  })

  it('a level count is a draw, and every stake goes back', async () => {
    const { matchId, by } = await newGame(2, 100)
    const before = { one: await wallet(by['1']!), two: await wallet(by['2']!) }
    await arrange(matchId, { '1': ['t10'], '2': ['x7', 's3', 'x1'] }, 'c7', ['c1'])
    expect(await request(matchId, by['1']!, (state, seat) => act(state, seat, { type: 'draw' }))).toMatchObject({ ok: true })
    expect(await match(matchId)).toMatchObject({ status: 'finished', result: 'draw', end_reason: 'market', winner_id: null, settled: true })
    expect(await wallet(by['1']!)).toBe(before.one + 100)
    expect(await wallet(by['2']!)).toBe(before.two + 100)
  })

  it('a player who leaves a two-player game loses it; at a bigger table the others play on', async () => {
    const two = await newGame(2, 50)
    expect(await request(two.matchId, two.by['2']!, (state, seat) => leave(state, seat))).toMatchObject({ ok: true })
    expect(await match(two.matchId)).toMatchObject({ status: 'finished', result: 'win', end_reason: 'last_standing', winner_id: users[two.by['1']!] })

    const three = await newGame(3)
    expect(await request(three.matchId, three.by['1']!, (state, seat) => leave(state, seat))).toMatchObject({ ok: true })
    expect(await match(three.matchId)).toMatchObject({ status: 'active' })
    expect(await table(three.matchId)).toMatchObject({ out_seats: ['1'], turn: '2', counts: { '1': 0, '2': 6, '3': 6 } })
  })
})

describe('the turn clock', () => {
  it('says when a turn has run out, by the database’s own clock', async () => {
    const { matchId, by } = await newGame()
    expect((await context(matchId, by['2']!))!.late).toBe(false)
    await db.pg.query(`update public.checkup_games set deadline = clock_timestamp() - interval '1 second' where match_id = $1`, [matchId])
    expect((await context(matchId, by['2']!))!.late).toBe(true)
    // Any player at the table may ask: the game goes to market for the late one.
    expect(await request(matchId, by['2']!, (state) => timeout(state))).toMatchObject({ ok: true })
    const after = await table(matchId)
    expect(after).toMatchObject({ turn: '2', counts: { '1': 7, '2': 6 }, missed: { '1': 1, '2': 0 } })
    expect(after.last_event).toEqual({ seat: '1', kind: 'timeout', drew: 1 })
    // And the clock was started again for the next player.
    expect((await context(matchId, by['2']!))!.late).toBe(false)
  })

  it('if nobody is there to ask, the sweep puts the late player out after a further wait', async () => {
    const three = await newGame(3)
    await db.pg.query(`update public.checkup_games set deadline = clock_timestamp() - interval '5 seconds' where match_id = $1`, [three.matchId])
    await db.pg.exec(`select private.sweep()`)
    // Not yet: the players' own apps are given time to ask first.
    expect((await table(three.matchId)).out_seats).toEqual([])
    await db.pg.query(`update public.checkup_games set deadline = clock_timestamp() - interval '30 seconds' where match_id = $1`, [three.matchId])
    await db.pg.exec(`select private.sweep()`)
    expect(await table(three.matchId)).toMatchObject({ out_seats: ['1'], turn: '2', counts: { '1': 0, '2': 6, '3': 6 }, phase: 'play' })
    expect((await context(three.matchId, three.by['2']!))!.state.hands['1']).toEqual([])
    expect(isSound((await context(three.matchId, three.by['2']!))!.state)).toBe(true)

    // Two players: the one still there wins.
    const two = await newGame(2, 50)
    await db.pg.query(`update public.checkup_games set deadline = clock_timestamp() - interval '30 seconds' where match_id = $1`, [two.matchId])
    await db.pg.exec(`select private.sweep()`)
    expect(await match(two.matchId)).toMatchObject({ status: 'finished', result: 'win', end_reason: 'last_standing', winner_id: users[two.by['2']!], settled: true })
  })
})

describe('a whole game through the database', () => {
  it('four players play to the end, every position recorded, and the ledger is whole', async () => {
    const { matchId, by } = await newGame(4, 50)
    for (let turns = 0; turns < 600; turns++) {
      const game = (await context(matchId, by['1']!))!
      if (game.status !== 'active') break
      const seat = game.state.turn
      const played = act(game.state, seat, chooseAction(game.state, seat))
      if (!played.ok) throw new Error(`refused: ${played.code}`)
      expect(await store(matchId, game.state.moveNo, played)).toMatchObject({ ok: true })
    }
    const done = await match(matchId)
    expect(done.status).toBe('finished')
    expect(done.settled).toBe(true)
    expect((await table(matchId)).phase).toBe('over')
  })
})
