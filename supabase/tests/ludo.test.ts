import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './testDb'

// Ludo's rules, played through the same function the ludo-action Edge Function calls. The dice
// are the server's; where a test needs a particular throw it puts the game in the position that
// follows the roll (phase 'move' with that die), which is exactly the state a real roll leaves.

let db: TestDb
const users: Record<string, string> = {}
type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
let n = 0

type Game = { positions: Record<string, number[]>; turn: string; phase: string; die: number | null; sixes: number; turn_no: number; misses: Json; acted: Json; last_event: Json | null }
const game = async (matchId: string) =>
  (await db.rows<Game>(`select positions, turn, phase, die, sixes, turn_no, misses, acted, last_event from public.ludo_games where match_id = $1`, [matchId]))[0]!
const match = async (matchId: string) =>
  (await db.rows<{ status: string; result: string | null; end_reason: string | null; winner_id: string | null }>(
    `select status, result, end_reason, winner_id from public.matches where id = $1`, [matchId]))[0]!
const act = async (user: string, matchId: string, action: string, piece: number | null = null, turnNo?: number, die: number | null = null): Promise<Json> =>
  (await db.rows<{ r: Json }>(`select public.ludo_action($1, $2, $3, $4, $5, $6) as r`, [matchId, users[user], action, piece, turnNo ?? (await game(matchId)).turn_no, die]))[0]!.r
/**
 * Puts the stored game into a given state. Naming a `die` describes "this was just thrown":
 * the throw, the dice still to play, and whether it earned another throw are filled in to match.
 */
const set = (matchId: string, given: Json) => {
  const fields: Json = { ...given }
  if ('die' in given && !('dice' in given)) {
    fields.dice = given.die === null ? [] : [given.die]
    fields.rolled = fields.dice
    fields.extra = given.die === 6
    if (!('sixes' in given)) fields.sixes = given.die === 6 ? 1 : 0
  }
  return db.pg.query(
    `update public.ludo_games set ${Object.keys(fields).map((k, i) => `${k} = $${i + 2}`).join(', ')} where match_id = $1`,
    [matchId, ...Object.values(fields).map((v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v))],
  )
}
const wallet = async (user: string) =>
  (await db.rows<{ bonus: number }>(`select bonus_balance::int as bonus from public.wallets where user_id = $1`, [users[user]]))[0]!.bonus

/** A new game. Returns the players by colour: red always moves first. */
async function newGame(mode = 'quick', stake = 0) {
  const a = `p${++n}`
  const b = `q${n}`
  for (const name of [a, b]) users[name] = await db.createUser(`${name}@example.com`, { username: name, country_code: 'GH', age_confirmed: true })
  const options = JSON.stringify({ mode })
  await db.pg.query(`select public.join_match_queue($1, 'ludo', $2, $3, 'default')`, [users[a], stake, options])
  const [row] = await db.rows<{ r: Json }>(`select public.join_match_queue($1, 'ludo', $2, $3, 'default') as r`, [users[b], stake, options])
  const matchId = row!.r.match_id as string
  const seats = await db.rows<{ user_id: string; seat: string }>(`select user_id, seat from public.match_players where match_id = $1`, [matchId])
  const by = (seat: string) => (seats.find((s) => s.seat === seat)!.user_id === users[a] ? a : b)
  return { matchId, red: by('red'), yellow: by('yellow') }
}
/** Both players have "played once", so the game counts as started. */
const started = (matchId: string) => set(matchId, { acted: { red: true, yellow: true } })

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

describe('starting', () => {
  it('seats the two players opposite each other with every piece in the yard, red to roll', async () => {
    const { matchId } = await newGame('classic')
    const g = await game(matchId)
    expect(g.positions).toEqual({ red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1] })
    expect(g).toMatchObject({ turn: 'red', phase: 'roll', die: null, turn_no: 0 })
    expect((await game((await newGame('quick')).matchId)).positions.red).toEqual([-1, -1])
  })

  it('refuses a mode that is not on offer, and makes no match', async () => {
    users.x = await db.createUser('x@example.com', { username: 'xx1', country_code: 'GH', age_confirmed: true })
    users.y = await db.createUser('y@example.com', { username: 'yy1', country_code: 'GH', age_confirmed: true })
    await db.pg.query(`select public.join_match_queue($1, 'ludo', 0, '{"mode":"giant"}', 'default')`, [users.x])
    await expect(db.pg.query(`select public.join_match_queue($1, 'ludo', 0, '{"mode":"giant"}', 'default')`, [users.y])).rejects.toThrow(/LUDO_UNKNOWN_MODE/)
    expect(await db.rows(`select 1 from public.matches m join public.match_players mp on mp.match_id = m.id where mp.user_id = $1`, [users.x])).toEqual([])
    await db.pg.exec(`delete from public.match_queue`)
  })
})

describe('the dice', () => {
  it('are fair enough: every face comes up, none far more than the others', async () => {
    const rows = await db.rows<{ face: number; times: number }>(
      `select private.ludo_roll() as face, count(*)::int as times from generate_series(1, 6000) group by 1 order by 1`)
    expect(rows.map((r) => r.face)).toEqual([1, 2, 3, 4, 5, 6])
    for (const row of rows) {
      expect(row.times).toBeGreaterThan(850)
      expect(row.times).toBeLessThan(1150)
    }
  })

  it('are thrown by the server: a roll follows the rules whatever comes up', async () => {
    const { matchId, red, yellow } = await newGame()
    // Yellow cannot roll on red's turn, and nobody can act on an old picture of the game.
    expect(await act(yellow, matchId, 'roll')).toEqual({ ok: false, code: 'NOT_YOUR_TURN' })
    expect(await act(red, matchId, 'roll', null, 7)).toEqual({ ok: false, code: 'OUT_OF_SYNC' })
    expect(await act(red, matchId, 'move', 0)).toEqual({ ok: false, code: 'ILLEGAL_MOVE' })

    expect(await act(red, matchId, 'roll')).toEqual({ ok: true })
    const g = await game(matchId)
    const die = g.last_event!.die as number
    expect(g.turn_no).toBe(1)
    expect(g.acted).toEqual({ red: true })
    if (die === 6) {
      // Both yard pieces would do the same thing, so the first is brought out, and red rolls again.
      expect(g.positions.red).toEqual([0, -1])
      expect(g).toMatchObject({ turn: 'red', phase: 'roll', sixes: 1 })
    } else {
      // Nothing can move without a six: the turn passes.
      expect(g.positions.red).toEqual([-1, -1])
      expect(g).toMatchObject({ turn: 'yellow', phase: 'roll', sixes: 0 })
    }
    const [log] = await db.rows(`select seat, die, piece from public.ludo_moves where match_id = $1`, [matchId])
    expect(log).toEqual({ seat: 'red', die, piece: die === 6 ? 0 : null })
  })
})

describe('moving', () => {
  it('only a piece that can legally move may be chosen; a normal move passes the turn', async () => {
    const { matchId, red } = await newGame('classic')
    await set(matchId, { positions: { red: [10, 54, -1, 56], yellow: [-1, -1, -1, -1] }, phase: 'move', die: 3 })
    // Piece 1 needs exactly 2 to get home, piece 2 is in the yard, piece 3 is already home.
    for (const piece of [1, 2, 3, 9]) expect(await act(red, matchId, 'move', piece)).toEqual({ ok: false, code: 'ILLEGAL_MOVE' })
    expect(await act(red, matchId, 'move', 0)).toEqual({ ok: true })
    const g = await game(matchId)
    expect(g.positions.red).toEqual([13, 54, -1, 56])
    expect(g).toMatchObject({ turn: 'yellow', phase: 'roll', die: null })
    expect(g.last_event).toMatchObject({ seat: 'red', die: 3, piece: 0, from: 10, to: 13, captured: 0 })
  })

  it('a six brings a piece out and earns another roll', async () => {
    const { matchId, red } = await newGame('classic')
    await set(matchId, { positions: { red: [20, -1, -1, -1], yellow: [-1, -1, -1, -1] }, phase: 'move', die: 6 })
    expect(await act(red, matchId, 'move', 2)).toEqual({ ok: true })
    const g = await game(matchId)
    expect(g.positions.red).toEqual([20, -1, 0, -1])
    expect(g).toMatchObject({ turn: 'red', phase: 'roll', sixes: 1 })
  })

  it('landing on an opponent sends it home and earns another roll', async () => {
    const { matchId, red } = await newGame()
    // Red's square 30 is yellow's square 4 (yellow starts 26 squares round the board).
    // Yellow has two pieces stacked on that square: one piece lands, so one is sent home.
    await set(matchId, { positions: { red: [27, 5], yellow: [4, 4] }, phase: 'move', die: 3 })
    expect(await act(red, matchId, 'move', 0)).toEqual({ ok: true })
    const g = await game(matchId)
    expect(g.positions).toEqual({ red: [30, 5], yellow: [-1, 4] })
    // A capture does not earn another throw: only a six does.
    expect(g).toMatchObject({ turn: 'yellow', phase: 'roll' })
    expect(g.last_event!.captured).toBe(1)
  })

  it('no capture on a safe square, in a home column, or by a piece merely passing over', async () => {
    const { matchId, red } = await newGame()
    // Square 34 is a star: red reaches it at progress 34, yellow stands there at progress 8.
    await set(matchId, { positions: { red: [31, 5], yellow: [8, 6] }, phase: 'move', die: 3 })
    await act(red, matchId, 'move', 0)
    expect((await game(matchId)).positions).toEqual({ red: [34, 5], yellow: [8, 6] })
    expect((await game(matchId)).turn).toBe('yellow')

    const second = await newGame()
    // Yellow's piece at 7 is on red's square 33: red jumps from 31 to 35, over it.
    await set(second.matchId, { positions: { red: [31, 52], yellow: [7, 52] }, phase: 'move', die: 4 })
    await act(second.red, second.matchId, 'move', 0)
    expect((await game(second.matchId)).positions).toEqual({ red: [35, 52], yellow: [7, 52] })
  })

  it('home needs the exact number, and getting a piece home earns another roll', async () => {
    const { matchId, red } = await newGame('classic')
    await set(matchId, { positions: { red: [53, 10, -1, -1], yellow: [-1, -1, -1, -1] }, phase: 'move', die: 3 })
    expect(await act(red, matchId, 'move', 0)).toEqual({ ok: true })
    const g = await game(matchId)
    expect(g.positions.red![0]).toBe(56)
    // Nor does bringing a piece home.
    expect(g).toMatchObject({ turn: 'yellow', phase: 'roll' })
  })

  it('bringing the last piece home wins the match and pays the pot', async () => {
    const { matchId, red, yellow } = await newGame('quick', 100)
    await started(matchId)
    await set(matchId, { positions: { red: [56, 54], yellow: [3, -1] }, phase: 'move', die: 2 })
    expect(await act(red, matchId, 'move', 1)).toEqual({ ok: true })
    expect(await match(matchId)).toMatchObject({ status: 'finished', result: 'win', end_reason: 'all_home', winner_id: users[red] })
    expect(await game(matchId)).toMatchObject({ phase: 'over', die: null })
    expect(await wallet(red)).toBe(1080)
    expect(await wallet(yellow)).toBe(900)
    // Ratings moved, in Ludo's own pool.
    const ratings = await db.rows<{ rating: number }>(`select rating from public.player_ratings where game_type = 'ludo' order by rating`)
    expect(ratings.map((r) => r.rating)).toEqual([1180, 1220])
    // Nothing more can be done in a finished game.
    expect(await act(yellow, matchId, 'roll')).toEqual({ ok: false, code: 'GAME_OVER' })
  })
})

describe('leaving and running out of time', () => {
  it('resigning before both have played calls the game off; afterwards it is a loss', async () => {
    const first = await newGame('quick', 100)
    expect(await act(first.yellow, first.matchId, 'resign')).toEqual({ ok: true })
    expect(await match(first.matchId)).toMatchObject({ status: 'aborted', end_reason: 'aborted_by_player' })
    expect(await wallet(first.red)).toBe(1000)

    const second = await newGame('quick', 100)
    await started(second.matchId)
    await act(second.yellow, second.matchId, 'resign')
    expect(await match(second.matchId)).toMatchObject({ status: 'finished', result: 'win', end_reason: 'resignation', winner_id: users[second.red] })
    expect(await wallet(second.yellow)).toBe(900)
  })

  it('a player who never takes their first turn: the game is called off and stakes go back', async () => {
    const { matchId, red, yellow } = await newGame('quick', 250)
    // Not yet: the clock has not run out.
    await act(yellow, matchId, 'claim')
    expect((await match(matchId)).status).toBe('active')
    await set(matchId, { deadline: new Date(Date.now() - 1000).toISOString() })
    expect(await act(yellow, matchId, 'claim')).toEqual({ ok: true })
    expect(await match(matchId)).toMatchObject({ status: 'aborted', end_reason: 'no_first_move' })
    expect(await wallet(red)).toBe(1000)
    expect(await wallet(yellow)).toBe(1000)
  })

  it('an absent player’s turns are played for them, and the third in a row loses on time', async () => {
    const { matchId, red } = await newGame('quick', 100)
    await started(matchId)
    const late = () => set(matchId, { deadline: new Date(Date.now() - 1000).toISOString(), turn: 'yellow', phase: 'roll', die: null, sixes: 0 })

    await late()
    await db.pg.exec(`select private.sweep()`)
    let g = await game(matchId)
    expect(g.misses.yellow).toBe(1)
    expect(g.turn_no).toBe(1)
    expect(await db.rows(`select auto from public.ludo_moves where match_id = $1`, [matchId])).toEqual([{ auto: true }])

    await late()
    await db.pg.exec(`select private.sweep()`)
    g = await game(matchId)
    expect(g.misses.yellow).toBe(2)
    expect((await match(matchId)).status).toBe('active')

    await late()
    await db.pg.exec(`select private.sweep()`)
    expect(await match(matchId)).toMatchObject({ status: 'finished', result: 'win', end_reason: 'timeout', winner_id: users[red] })
    expect(await wallet(red)).toBe(1080)
  })

  it('playing a turn yourself clears the count, and the clock chooses the piece furthest along', async () => {
    const { matchId, yellow } = await newGame('classic')
    await started(matchId)
    await set(matchId, { misses: { yellow: 2 }, turn: 'yellow', phase: 'move', die: 2, positions: { red: [-1, -1, -1, -1], yellow: [5, 40, 12, -1] } })
    await act(yellow, matchId, 'move', 0)
    expect((await game(matchId)).misses.yellow).toBe(0)

    await set(matchId, { deadline: new Date(Date.now() - 1000).toISOString(), turn: 'yellow', phase: 'move', die: 2 })
    await db.pg.exec(`select private.sweep()`)
    expect((await game(matchId)).positions.yellow).toEqual([7, 42, 12, -1])
  })
})

describe('access', () => {
  it('players read their own game; nobody writes it or calls the action function directly', async () => {
    const { matchId, red } = await newGame()
    users.nosy = await db.createUser('nosy@example.com', { username: 'nosy', country_code: 'GH', age_confirmed: true })
    const read = (user: string) => db.as('authenticated', users[user]!, () => db.rows(`select turn from public.ludo_games where match_id = $1`, [matchId]))
    expect(await read(red)).toEqual([{ turn: 'red' }])
    expect(await read('nosy')).toEqual([])
    expect(await act('nosy', matchId, 'roll')).toEqual({ ok: false, code: 'NOT_A_PLAYER' })
    await expect(
      db.as('authenticated', users[red]!, () => db.rows(`update public.ludo_games set positions = '{"red":[56,56],"yellow":[-1,-1]}' where match_id = $1 returning 1`, [matchId])),
    ).rejects.toThrow()
    await expect(db.as('authenticated', users[red]!, () => db.rows(`select public.ludo_action($1, $2, 'roll', null, 0)`, [matchId, users[red]]))).rejects.toThrow(/permission denied/)
    await expect(db.as('authenticated', users[red]!, () => db.rows(`select private.ludo_roll()`))).rejects.toThrow(/permission denied/)
  })
})

describe('three and four players', () => {
  /** A table of `size` new players. Returns each player's name by colour. */
  async function newTable(size: number, stake = 0, mode = 'quick') {
    const names = Array.from({ length: size }, (_, i) => `t${++n}_${i}`)
    const options = JSON.stringify({ mode, players: size })
    let matchId = ''
    for (const name of names) {
      users[name] = await db.createUser(`${name}@example.com`, { username: name, country_code: 'GH', age_confirmed: true })
      const [row] = await db.rows<{ r: Json }>(`select public.join_match_queue($1, 'ludo', $2, $3, 'default', $4) as r`, [users[name], stake, options, size])
      if (name === names.at(-1)) matchId = row!.r.match_id as string
      else expect(row!.r).toEqual({ status: 'queued' })
    }
    const seats = await db.rows<{ user_id: string; seat: string }>(`select user_id, seat from public.match_players where match_id = $1`, [matchId])
    const by: Record<string, string> = {}
    for (const s of seats) by[s.seat] = names.find((name) => users[name] === s.user_id)!
    return { matchId, by, names }
  }
  const everyoneActed = (matchId: string, seats: string[]) => set(matchId, { acted: Object.fromEntries(seats.map((s) => [s, true])) })
  const table = async (matchId: string) => (await db.rows<{ places: string[]; gone: string[] }>(`select places, gone from public.ludo_games where match_id = $1`, [matchId]))[0]!

  it('a table fills before the game starts; seats go round the board; every stake is held', async () => {
    const four = await newTable(4, 100)
    expect(Object.keys(four.by).sort()).toEqual(['blue', 'green', 'red', 'yellow'])
    expect(Object.keys((await game(four.matchId)).positions).sort()).toEqual(['blue', 'green', 'red', 'yellow'])
    const [held] = await db.rows<{ total: number }>(`select sum(amount)::int as total from public.escrow where match_id = $1 and status = 'held'`, [four.matchId])
    expect(held!.total).toBe(400)
    for (const name of four.names) expect(await wallet(name)).toBe(900)

    const three = await newTable(3)
    expect(Object.keys(three.by).sort()).toEqual(['green', 'red', 'yellow'])
  })

  it('players who asked for different table sizes are not seated together', async () => {
    for (const [name, size] of [['m1', 2], ['m2', 4], ['m3', 3]] as const) {
      users[name] = await db.createUser(`${name}@example.com`, { username: name, country_code: 'GH', age_confirmed: true })
      const [row] = await db.rows<{ r: Json }>(`select public.join_match_queue($1, 'ludo', 0, $2, 'default', $3) as r`, [users[name], JSON.stringify({ mode: 'quick', players: size }), size])
      expect(row!.r).toEqual({ status: 'queued' })
    }
    // More players than the game allows is refused outright.
    const [row] = await db.rows<{ r: Json }>(`select public.join_match_queue($1, 'ludo', 0, '{"mode":"quick","players":5}', 'default', 5) as r`, [users.m1])
    expect(row!.r).toEqual({ status: 'error', code: 'OPTIONS_NOT_ALLOWED' })
    await db.pg.exec(`delete from public.match_queue`)
  })

  it('staked: the first player home takes the whole pot and the game ends for everyone', async () => {
    const { matchId, by } = await newTable(4, 100)
    await everyoneActed(matchId, ['red', 'green', 'yellow', 'blue'])
    // The turn goes clockwise: red, then green.
    await set(matchId, { positions: { red: [10, 20], green: [5, 5], yellow: [5, 5], blue: [5, 5] }, phase: 'move', die: 2 })
    await act(by.red!, matchId, 'move', 0)
    expect((await game(matchId)).turn).toBe('green')

    await set(matchId, { positions: { red: [10, 20], green: [56, 53], yellow: [40, 41], blue: [5, 5] }, phase: 'move', die: 3 })
    expect(await act(by.green!, matchId, 'move', 1)).toEqual({ ok: true })
    expect(await match(matchId)).toMatchObject({ status: 'finished', result: 'win', end_reason: 'all_home', winner_id: users[by.green!] })
    expect(await game(matchId)).toMatchObject({ phase: 'over' })
    expect((await table(matchId)).places).toEqual(['green'])
    // Pot of 400 less the 10% fee, to the winner alone.
    expect(await wallet(by.green!)).toBe(900 + 360)
    for (const seat of ['red', 'yellow', 'blue']) expect(await wallet(by[seat]!)).toBe(900)
    expect(await act(by.yellow!, matchId, 'roll')).toEqual({ ok: false, code: 'GAME_OVER' })

    // Ratings: the winner gains what the three others lose between them.
    const changes = await db.rows<{ seat: string; change: number }>(`select seat, rating_after - rating_before as change from public.match_players where match_id = $1`, [matchId])
    expect(Object.fromEntries(changes.map((c) => [c.seat, c.change]))).toEqual({ green: 30, red: -10, yellow: -10, blue: -10 })
  })

  it('free: the match has its winner, and the others may play on for second and third', async () => {
    const { matchId, by } = await newTable(3)
    await everyoneActed(matchId, ['red', 'green', 'yellow'])
    await set(matchId, { positions: { red: [56, 54], green: [10, 12], yellow: [30, 31] }, phase: 'move', die: 2 })
    await act(by.red!, matchId, 'move', 1)
    // Decided and rated...
    expect(await match(matchId)).toMatchObject({ status: 'finished', result: 'win', winner_id: users[by.red!] })
    const [rated] = await db.rows<{ n: number }>(`select count(*)::int as n from public.match_players where match_id = $1 and rating_after is not null`, [matchId])
    expect(rated!.n).toBe(3)
    // ...but the table is still open, and the turn has gone on to the next player still in.
    let g = await game(matchId)
    expect(g).toMatchObject({ phase: 'roll', turn: 'green' })
    expect(await act(by.red!, matchId, 'roll')).toEqual({ ok: false, code: 'NOT_YOUR_TURN' })
    expect(await act(by.green!, matchId, 'roll')).toEqual({ ok: true })

    // Yellow comes home second; green, the last one left, is third, and the table closes.
    await set(matchId, { positions: { red: [56, 56], green: [10, 12], yellow: [56, 55] }, turn: 'yellow', phase: 'move', die: 1 })
    await act(by.yellow!, matchId, 'move', 1)
    g = await game(matchId)
    expect(g.phase).toBe('over')
    expect((await table(matchId)).places).toEqual(['red', 'yellow', 'green'])
    // The result of the match did not change.
    expect((await match(matchId)).winner_id).toBe(users[by.red!])
  })

  it('free: those playing on can stop whenever they like, and are free to start another game', async () => {
    const { matchId, by } = await newTable(3)
    await everyoneActed(matchId, ['red', 'green', 'yellow'])
    await set(matchId, { positions: { red: [56, 54], green: [10, 12], yellow: [30, 31] }, phase: 'move', die: 2 })
    await act(by.red!, matchId, 'move', 1)
    // The match is over as far as the hub is concerned: nobody is held in it.
    const [busy] = await db.rows<{ m: string | null }>(`select private.active_match_of($1) as m`, [users[by.green!]])
    expect(busy!.m).toBeNull()
    expect(await act(by.green!, matchId, 'resign')).toEqual({ ok: true })
    expect((await game(matchId)).phase).toBe('over')
    expect((await table(matchId)).gone).toEqual(['green'])
  })

  it('staked: a player who resigns leaves their stake in the pot and the others carry on', async () => {
    const { matchId, by } = await newTable(4, 100)
    await everyoneActed(matchId, ['red', 'green', 'yellow', 'blue'])
    await set(matchId, { positions: { red: [10, 20], green: [5, 6], yellow: [7, 8], blue: [9, 11] } })

    // Red leaves on their own turn: their pieces come off and it is green's turn.
    expect(await act(by.red!, matchId, 'resign')).toEqual({ ok: true })
    let g = await game(matchId)
    expect(g.positions.red).toEqual([-1, -1])
    expect(g).toMatchObject({ turn: 'green', phase: 'roll' })
    expect((await match(matchId)).status).toBe('active')
    expect(await act(by.red!, matchId, 'roll')).toEqual({ ok: false, code: 'NOT_YOUR_TURN' })

    // Yellow leaves while it is not their turn: the turn stays where it is.
    await act(by.yellow!, matchId, 'resign')
    g = await game(matchId)
    expect(g.turn).toBe('green')
    // After green, the turn skips the two empty seats and goes to blue.
    await set(matchId, { phase: 'move', die: 1 })
    await act(by.green!, matchId, 'move', 0)
    expect((await game(matchId)).turn).toBe('blue')

    // Blue leaves too: green is the last one standing and takes the pot.
    await act(by.blue!, matchId, 'resign')
    expect(await match(matchId)).toMatchObject({ status: 'finished', result: 'win', end_reason: 'resignation', winner_id: users[by.green!] })
    expect(await wallet(by.green!)).toBe(900 + 360)
    expect(await wallet(by.red!)).toBe(900)
  })

  it('a player who misses three turns in a row is out, and the game goes on without them', async () => {
    const { matchId, by } = await newTable(3, 50)
    await everyoneActed(matchId, ['red', 'green', 'yellow'])
    await set(matchId, { misses: { red: 2 }, deadline: new Date(Date.now() - 1000).toISOString() })
    await db.pg.exec(`select private.sweep()`)
    const g = await game(matchId)
    expect((await table(matchId)).gone).toEqual(['red'])
    expect(g).toMatchObject({ turn: 'green', phase: 'roll' })
    expect((await match(matchId)).status).toBe('active')
    expect(await act(by.green!, matchId, 'roll')).toEqual({ ok: true })
  })
})

describe('two dice', () => {
  /** A two-player game with two dice. */
  async function twoDice(mode = 'classic') {
    const a = `d${++n}`
    const b = `e${n}`
    for (const name of [a, b]) users[name] = await db.createUser(`${name}@example.com`, { username: name, country_code: 'GH', age_confirmed: true })
    const options = JSON.stringify({ mode, players: 2, dice: 2 })
    await db.pg.query(`select public.join_match_queue($1, 'ludo', 0, $2, 'default')`, [users[a], options])
    const [row] = await db.rows<{ r: Json }>(`select public.join_match_queue($1, 'ludo', 0, $2, 'default') as r`, [users[b], options])
    const matchId = row!.r.match_id as string
    const seats = await db.rows<{ user_id: string; seat: string }>(`select user_id, seat from public.match_players where match_id = $1`, [matchId])
    const by = (seat: string) => (seats.find((x) => x.seat === seat)!.user_id === users[a] ? a : b)
    return { matchId, red: by('red'), yellow: by('yellow') }
  }
  const dice = async (matchId: string) =>
    (await db.rows<{ dice: number[]; rolled: number[]; dice_count: number; extra: boolean }>(`select dice, rolled, dice_count, extra from public.ludo_games where match_id = $1`, [matchId]))[0]!
  /** The state a throw of these two dice leaves, with a choice still to be made. */
  const thrown = (matchId: string, a: number, b: number, more: Json = {}) =>
    set(matchId, { dice: [a, b], rolled: [a, b], extra: a === 6 && b === 6, sixes: a === 6 && b === 6 ? 1 : 0, phase: 'move', die: a, ...more })

  it('a game is made with the number of dice its players asked for, and they are only matched with each other', async () => {
    const { matchId } = await twoDice()
    expect((await dice(matchId)).dice_count).toBe(2)
    // Someone asking for one die is not seated with someone asking for two.
    for (const [name, count] of [['od1', 1], ['od2', 2]] as const) {
      users[name] = await db.createUser(`${name}@example.com`, { username: name, country_code: 'GH', age_confirmed: true })
      const [row] = await db.rows<{ r: Json }>(`select public.join_match_queue($1, 'ludo', 0, $2, 'default') as r`, [users[name], JSON.stringify({ mode: 'quick', players: 2, dice: count })])
      expect(row!.r).toEqual({ status: 'queued' })
    }
    await db.pg.exec(`delete from public.match_queue`)
  })

  it('a throw is two dice from the server, and follows the rules whatever falls', async () => {
    const { matchId, red } = await twoDice('quick')
    expect(await act(red, matchId, 'roll')).toEqual({ ok: true })
    const g = await game(matchId)
    const d = await dice(matchId)
    expect(d.rolled).toHaveLength(2)
    for (const face of d.rolled) expect(face).toBeGreaterThanOrEqual(1), expect(face).toBeLessThanOrEqual(6)
    const [a, b] = d.rolled as [number, number]
    if (a !== 6 && b !== 6) {
      // Nothing can leave the yard without a six, and no double but a double six throws again.
      expect(g.positions.red).toEqual([-1, -1])
      expect(g).toMatchObject({ phase: 'roll', turn: 'yellow' })
    } else {
      // A six can bring a piece out, and the other die can be walked with it or kept: the
      // player is asked.
      expect(g).toMatchObject({ phase: 'move', turn: 'red' })
    }
  })

  it('each die is a move of its own, on different pieces or the same one, in the order the player chooses', async () => {
    const { matchId, red } = await twoDice()
    await thrown(matchId, 3, 5, { positions: { red: [10, 20, -1, -1], yellow: [-1, -1, -1, -1] } })
    // A die that was not thrown cannot be played, nor a piece that cannot use the die.
    expect(await act(red, matchId, 'move', 0, undefined, 4)).toEqual({ ok: false, code: 'ILLEGAL_MOVE' })
    expect(await act(red, matchId, 'move', 2, undefined, 3)).toEqual({ ok: false, code: 'ILLEGAL_MOVE' })

    // The 5 first, on the first piece: the 3 is still to play, and it is still red's move.
    expect(await act(red, matchId, 'move', 0, undefined, 5)).toEqual({ ok: true })
    let g = await game(matchId)
    expect(g.positions.red).toEqual([15, 20, -1, -1])
    expect(g).toMatchObject({ turn: 'red', phase: 'move', die: 3 })
    expect((await dice(matchId)).dice).toEqual([3])
    // The same die cannot be played twice.
    expect(await act(red, matchId, 'move', 1, undefined, 5)).toEqual({ ok: false, code: 'ILLEGAL_MOVE' })

    // The 3 on the other piece ends the throw and the turn.
    expect(await act(red, matchId, 'move', 1, undefined, 3)).toEqual({ ok: true })
    g = await game(matchId)
    expect(g.positions.red).toEqual([15, 23, -1, -1])
    expect(g).toMatchObject({ turn: 'yellow', phase: 'roll', die: null })
    expect((await dice(matchId)).dice).toEqual([])
    const log = await db.rows(`select die, piece, from_progress, to_progress from public.ludo_moves where match_id = $1 order by seq`, [matchId])
    expect(log).toEqual([
      { die: 5, piece: 0, from_progress: 10, to_progress: 15 },
      { die: 3, piece: 1, from_progress: 20, to_progress: 23 },
    ])
  })

  it('both dice on one piece: when only one piece is on the board the second die follows by itself', async () => {
    const { matchId, red } = await twoDice()
    await thrown(matchId, 2, 4, { positions: { red: [10, -1, -1, -1], yellow: [-1, -1, -1, -1] } })
    // Which die goes first is still the player's choice (it can decide what is captured).
    expect(await act(red, matchId, 'move', 0, undefined, 4)).toEqual({ ok: true })
    const g = await game(matchId)
    expect(g.positions.red).toEqual([16, -1, -1, -1])
    expect(g).toMatchObject({ turn: 'yellow', phase: 'roll' })
  })

  it('a six on one die brings a piece out, and the other die can then move it', async () => {
    const { matchId, red } = await twoDice()
    await thrown(matchId, 6, 3, { positions: { red: [-1, -1, -1, -1], yellow: [5, -1, -1, -1] } })
    // Only the six can be played first; the pieces in the yard are all alike, so any will do.
    expect(await act(red, matchId, 'move', 0, undefined, 3)).toEqual({ ok: false, code: 'ILLEGAL_MOVE' })
    expect(await act(red, matchId, 'move', 0, undefined, 6)).toEqual({ ok: true })
    const g = await game(matchId)
    // Out on the six, then on with the three, which nothing else could use.
    expect(g.positions.red).toEqual([3, -1, -1, -1])
    // A six is not a double: with two dice it earns no extra throw.
    expect(g).toMatchObject({ turn: 'yellow', phase: 'roll' })
  })

  it('only a double six earns another throw: no other double does, and neither does a capture', async () => {
    const sixes = await twoDice()
    await thrown(sixes.matchId, 6, 6, { positions: { red: [10, 20, -1, -1], yellow: [-1, -1, -1, -1] } })
    await act(sixes.red, sixes.matchId, 'move', 0, undefined, 6)
    await act(sixes.red, sixes.matchId, 'move', 1, undefined, 6)
    expect(await game(sixes.matchId)).toMatchObject({ turn: 'red', phase: 'roll', sixes: 1 })

    const twos = await twoDice()
    await thrown(twos.matchId, 2, 2, { positions: { red: [10, 20, -1, -1], yellow: [-1, -1, -1, -1] } })
    await act(twos.red, twos.matchId, 'move', 0, undefined, 2)
    await act(twos.red, twos.matchId, 'move', 1, undefined, 2)
    expect(await game(twos.matchId)).toMatchObject({ turn: 'yellow', phase: 'roll', sixes: 0 })

    const capture = await twoDice()
    // Red's square 30 is yellow's square 4.
    await thrown(capture.matchId, 3, 1, { positions: { red: [27, 40, -1, -1], yellow: [4, -1, -1, -1] } })
    await act(capture.red, capture.matchId, 'move', 0, undefined, 3)
    expect((await game(capture.matchId)).positions.yellow).toEqual([-1, -1, -1, -1])
    // The other die is still to play; once it is, the turn passes like any other.
    await act(capture.red, capture.matchId, 'move', 1, undefined, 1)
    expect(await game(capture.matchId)).toMatchObject({ turn: 'yellow', phase: 'roll' })
  })

  it('the server throws again only on a double six, however many throws are watched', async () => {
    const { matchId } = await twoDice()
    await started(matchId)
    // Sixty turns played by the clock, as an absent player's would be. After each, whoever threw
    // keeps the turn only if both dice were sixes (and something could then be played or not).
    for (let i = 0; i < 60; i++) {
      const before = await game(matchId)
      if (before.phase === 'over') break
      await set(matchId, { misses: {}, deadline: new Date(Date.now() - 1000).toISOString() })
      await db.pg.exec(`select private.sweep()`)
      const after = await game(matchId)
      const [d] = await db.rows<{ rolled: number[] }>(`select rolled from public.ludo_games where match_id = $1`, [matchId])
      if (before.phase === 'roll' && after.phase !== 'over') {
        const doubleSix = d!.rolled[0] === 6 && d!.rolled[1] === 6
        // (Three double sixes in a row lose the turn; that one case aside, the rule is exact.)
        if (!(doubleSix && before.sixes === 2)) expect(after.turn === before.turn, `threw ${d!.rolled} as ${before.turn}`).toBe(doubleSix)
      }
    }
  })

  it('a die no piece can use is lost, and a throw nothing can use passes the turn', async () => {
    const { matchId, red } = await twoDice()
    // The only piece on the board needs exactly 2 to get home: the 5 is lost.
    await thrown(matchId, 5, 2, { positions: { red: [54, 56, 56, -1], yellow: [-1, -1, -1, -1] } })
    await set(matchId, { phase: 'roll' })
    await db.pg.query(`select private.ludo_settle_throw($1, false)`, [matchId])
    const g = await game(matchId)
    expect(g.positions.red).toEqual([56, 56, 56, -1])
    expect(g).toMatchObject({ turn: 'yellow', phase: 'roll' })
    void red
  })

  it('the clock plays both dice for an absent player', async () => {
    const { matchId } = await twoDice()
    await started(matchId)
    await thrown(matchId, 3, 5, { positions: { red: [10, 20, -1, -1], yellow: [-1, -1, -1, -1] }, deadline: new Date(Date.now() - 1000).toISOString() })
    await db.pg.exec(`select private.sweep()`)
    const g = await game(matchId)
    // The dice as they lie, each on the piece furthest along at that moment.
    expect(g.positions.red).toEqual([10, 28, -1, -1])
    expect(g).toMatchObject({ turn: 'yellow', phase: 'roll' })
    expect(g.misses.red).toBe(1)
  })

  it('winning with the second die ends the game at once', async () => {
    const { matchId, red } = await twoDice('quick')
    await started(matchId)
    await thrown(matchId, 1, 2, { positions: { red: [55, 54], yellow: [3, -1] } })
    await act(red, matchId, 'move', 0, undefined, 1)
    // The last die had only one use: it was played, and that was the game.
    expect(await match(matchId)).toMatchObject({ status: 'finished', result: 'win', end_reason: 'all_home', winner_id: users[red] })
    expect(await game(matchId)).toMatchObject({ phase: 'over' })
  })
})

describe('both sides, lay and full count', () => {
  /** A two-player game with the given choices. */
  async function table(options: Json) {
    const a = `s${++n}`
    const b = `u${n}`
    for (const name of [a, b]) users[name] = await db.createUser(`${name}@example.com`, { username: name, country_code: 'GH', age_confirmed: true })
    const chosen = JSON.stringify({ mode: 'quick', players: 2, dice: 2, sides: 1, lay: false, ...options })
    await db.pg.query(`select public.join_match_queue($1, 'ludo', $2, $3, 'default')`, [users[a], options.stake ?? 0, chosen])
    const [row] = await db.rows<{ r: Json }>(`select public.join_match_queue($1, 'ludo', $2, $3, 'default') as r`, [users[b], options.stake ?? 0, chosen])
    const matchId = row!.r.match_id as string
    const seats = await db.rows<{ user_id: string; seat: string }>(`select user_id, seat from public.match_players where match_id = $1`, [matchId])
    const by: Record<string, string> = {}
    for (const x of seats) by[x.seat] = x.user_id === users[a] ? a : b
    return { matchId, by }
  }
  const thrown = (matchId: string, a: number, b: number, more: Json = {}) =>
    set(matchId, { dice: [a, b], rolled: [a, b], extra: a === 6 && b === 6, sixes: a === 6 && b === 6 ? 1 : 0, phase: 'move', die: a, ...more })
  /** A move naming the colour, and optionally the full count. */
  const play = async (user: string, matchId: string, color: string, piece: number, die: number | null, full = false): Promise<Json> =>
    (await db.rows<{ r: Json }>(`select public.ludo_action($1, $2, 'move', $3, $4, $5, $6, $7) as r`, [matchId, users[user], piece, (await game(matchId)).turn_no, die, color, full]))[0]!.r

  it('both sides: each player holds two houses, opposite each other, and plays one throw on any of them', async () => {
    const { matchId, by } = await table({ sides: 2 })
    const g = await game(matchId)
    expect(Object.keys(by).sort()).toEqual(['green', 'red'])
    expect(g.positions).toEqual({ red: [-1, -1], yellow: [-1, -1], green: [-1, -1], blue: [-1, -1] })
    const [teams] = await db.rows<{ teams: Json }>(`select teams from public.ludo_games where match_id = $1`, [matchId])
    expect(teams!.teams).toEqual({ red: ['red', 'yellow'], green: ['green', 'blue'] })

    await thrown(matchId, 3, 5, { positions: { red: [10, -1], yellow: [20, -1], green: [4, -1], blue: [-1, -1] } })
    // The 5 on the yellow piece, the 3 on the red one: both are this player's.
    expect(await play(by.red!, matchId, 'yellow', 0, 5)).toEqual({ ok: true })
    expect(await play(by.red!, matchId, 'green', 0, 3)).toEqual({ ok: false, code: 'ILLEGAL_MOVE' })
    expect(await play(by.red!, matchId, 'red', 0, 3)).toEqual({ ok: true })
    const after = await game(matchId)
    expect(after.positions).toMatchObject({ red: [13, -1], yellow: [25, -1] })
    // The turn goes to the other player, not to the player's own second colour.
    expect(after).toMatchObject({ turn: 'green', phase: 'roll' })
    expect(await act(by.green!, matchId, 'roll')).toEqual({ ok: true })
  })

  it('both sides: a player never captures their own other colour, and wins only when every piece of both is home', async () => {
    const { matchId, by } = await table({ sides: 2 })
    await started(matchId)
    await set(matchId, { acted: { red: true, green: true } })
    // Yellow's square 4 is red's square 30: red lands on its own partner and nothing happens.
    await thrown(matchId, 3, 1, { positions: { red: [27, 56], yellow: [4, 56], green: [-1, -1], blue: [-1, -1] } })
    await play(by.red!, matchId, 'red', 0, 3)
    expect((await game(matchId)).positions).toMatchObject({ red: [30, 56], yellow: [4, 56] })

    // Red's own two pieces are home, but the game is not won until yellow's are too.
    await thrown(matchId, 2, 4, { turn: 'red', positions: { red: [54, 56], yellow: [40, 56], green: [3, -1], blue: [-1, -1] } })
    await play(by.red!, matchId, 'red', 0, 2)
    expect((await game(matchId)).positions).toMatchObject({ red: [56, 56], yellow: [44, 56] })
    expect((await match(matchId)).status).toBe('active')
    // The last piece of the second house comes home: that is the game.
    await thrown(matchId, 1, 3, { turn: 'red', positions: { red: [56, 56], yellow: [55, 56], green: [3, -1], blue: [-1, -1] } })
    await db.pg.query(`select private.ludo_settle_throw($1, false)`, [matchId])
    expect(await match(matchId)).toMatchObject({ status: 'finished', result: 'win', end_reason: 'all_home', winner_id: users[by.red!] })
  })

  it('lay: a piece that captures goes straight home and the captured piece goes back', async () => {
    const { matchId, by } = await table({ lay: true })
    // Red's square 30 is yellow's square 4.
    await thrown(matchId, 3, 1, { positions: { red: [27, 40], yellow: [4, 9] } })
    expect(await play(by.red!, matchId, 'red', 0, 3)).toEqual({ ok: true })
    // The other die had only one piece to go to, so it was played at once. The turn then
    // passes: a capture does not earn another throw.
    const g = await game(matchId)
    expect(g.positions).toEqual({ red: [56, 41], yellow: [-1, 9] })
    expect(g).toMatchObject({ turn: 'yellow', phase: 'roll' })
    const [log] = await db.rows(`select color, die, from_progress, to_progress, captured from public.ludo_moves where match_id = $1 order by seq limit 1`, [matchId])
    expect(log).toEqual({ color: 'red', die: 3, from_progress: 27, to_progress: 56, captured: 1 })
  })

  it('lay: capturing with the last piece on the board wins the game; without lay the piece stays where it landed', async () => {
    const lay = await table({ lay: true, stake: 100 })
    await set(lay.matchId, { acted: { red: true, yellow: true } })
    // (The last die of a throw: with both still to play, the piece would have to count them both.)
    await set(lay.matchId, { dice: [3], rolled: [5, 3], phase: 'move', die: 3, positions: { red: [27, 56], yellow: [4, 9] } })
    await play(lay.by.red!, lay.matchId, 'red', 0, 3)
    expect(await match(lay.matchId)).toMatchObject({ status: 'finished', result: 'win', winner_id: users[lay.by.red!] })
    expect(await wallet(lay.by.red!)).toBe(1080)

    const stay = await table({ lay: false })
    await thrown(stay.matchId, 3, 1, { positions: { red: [27, 40], yellow: [4, 9] } })
    await play(stay.by.red!, stay.matchId, 'red', 0, 3)
    expect((await game(stay.matchId)).positions).toEqual({ red: [30, 40], yellow: [-1, 9] })
  })

  it('full count: one piece takes both dice as a single move and touches nothing on the way', async () => {
    const { matchId, by } = await table({ lay: true })
    // Yellow stands on red's square 14 (4 away). Played one die at a time, the 4 would capture
    // there; the full count of 10 goes straight past.
    await thrown(matchId, 4, 6, { positions: { red: [10, -1], yellow: [40, -1] } })
    expect(await play(by.red!, matchId, 'red', 0, null, true)).toEqual({ ok: true })
    const g = await game(matchId)
    expect(g.positions).toEqual({ red: [20, -1], yellow: [40, -1] })
    expect(g.last_event).toMatchObject({ full: true, die: 10, from: 10, to: 20, captured: 0 })
    // Both dice are used up, and nothing earned another throw.
    expect(g).toMatchObject({ turn: 'yellow', phase: 'roll' })
    const [log] = await db.rows(`select die, full_count from public.ludo_moves where match_id = $1`, [matchId])
    expect(log).toEqual({ die: 10, full_count: true })
  })

  it('full count: from the yard it needs a six, never overshoots home, and needs both dice still unplayed', async () => {
    const { matchId, by } = await table({})
    // 6 and 4 from the yard: out on the six and on four squares, in one move.
    await thrown(matchId, 6, 4, { positions: { red: [-1, 50], yellow: [-1, -1] } })
    // The piece at 50 would need 10 to stay on the board: 50 + 10 is past home.
    expect(await play(by.red!, matchId, 'red', 1, null, true)).toEqual({ ok: false, code: 'ILLEGAL_MOVE' })
    expect(await play(by.red!, matchId, 'red', 0, null, true)).toEqual({ ok: true })
    expect((await game(matchId)).positions.red).toEqual([4, 50])

    // No six: a piece in the yard cannot take a full count.
    await thrown(matchId, 5, 4, { turn: 'red', positions: { red: [-1, 10], yellow: [-1, -1] } })
    expect(await play(by.red!, matchId, 'red', 0, null, true)).toEqual({ ok: false, code: 'ILLEGAL_MOVE' })
    // Once one die has been played there is no full count left to take.
    await play(by.red!, matchId, 'red', 1, 5)
    const g = await game(matchId)
    expect(g.positions.red).toEqual([-1, 19])
    expect(g).toMatchObject({ turn: 'yellow', phase: 'roll' })
  })

  it('full count that lands on an opponent captures there, and lays when the game is played that way', async () => {
    const { matchId, by } = await table({ lay: true })
    // Red's square 30 is yellow's square 4: 27 + (2 + 1).
    await thrown(matchId, 2, 1, { positions: { red: [27, 40], yellow: [4, 9] } })
    await play(by.red!, matchId, 'red', 0, null, true)
    const g = await game(matchId)
    expect(g.positions).toEqual({ red: [56, 40], yellow: [-1, 9] })
    expect(g).toMatchObject({ turn: 'yellow', phase: 'roll' })
  })

  it('resigning and the clock count players, not colours', async () => {
    const { matchId, by } = await table({ sides: 2, stake: 100 })
    // Nobody has played: leaving calls the game off, whoever holds however many colours.
    await act(by.green!, matchId, 'resign')
    expect(await match(matchId)).toMatchObject({ status: 'aborted', end_reason: 'aborted_by_player' })

    const second = await table({ sides: 2, stake: 100 })
    await set(second.matchId, { acted: { red: true, green: true } })
    await act(second.by.green!, second.matchId, 'resign')
    expect(await match(second.matchId)).toMatchObject({ status: 'finished', result: 'win', end_reason: 'resignation', winner_id: users[second.by.red!] })
    expect(await wallet(second.by.red!)).toBe(1080)
  })
})

describe('both dice must be played; the gate', () => {
  async function table(options: Json) {
    const a = `v${++n}`
    const b = `w${n}`
    for (const name of [a, b]) users[name] = await db.createUser(`${name}@example.com`, { username: name, country_code: 'GH', age_confirmed: true })
    const chosen = JSON.stringify({ mode: 'classic', players: 2, dice: 2, sides: 1, lay: true, ...options })
    await db.pg.query(`select public.join_match_queue($1, 'ludo', 0, $2, 'default')`, [users[a], chosen])
    const [row] = await db.rows<{ r: Json }>(`select public.join_match_queue($1, 'ludo', 0, $2, 'default') as r`, [users[b], chosen])
    const matchId = row!.r.match_id as string
    const seats = await db.rows<{ user_id: string; seat: string }>(`select user_id, seat from public.match_players where match_id = $1`, [matchId])
    const by: Record<string, string> = {}
    for (const x of seats) by[x.seat] = x.user_id === users[a] ? a : b
    return { matchId, red: by.red!, yellow: by.yellow! }
  }
  const thrown = (matchId: string, a: number, b: number, positions: Json) =>
    set(matchId, { dice: [a, b], rolled: [a, b], extra: a === 6 && b === 6, sixes: 0, phase: 'move', die: a, turn: 'red', positions })
  const play = async (user: string, matchId: string, piece: number, die: number | null, full = false): Promise<Json> =>
    (await db.rows<{ r: Json }>(`select public.ludo_action($1, $2, 'move', $3, $4, $5, 'red', $6) as r`, [matchId, users[user], piece, (await game(matchId)).turn_no, die, full]))[0]!.r
  const legal = async (matchId: string) =>
    db.rows<{ piece: number; die: number }>(`select l.piece, l.die from public.ludo_games g, private.ludo_legal(g) l where g.match_id = $1 order by 1, 2`, [matchId])

  it('5 and 5, one piece on the board, an opponent five ahead: the capture would waste a die, so the piece counts all ten', async () => {
    const { matchId, red } = await table({})
    // Red's square 15 is yellow's square 41 (yellow starts 26 round the board).
    await thrown(matchId, 5, 5, { red: [10, 56, 56, 56], yellow: [41, -1, -1, -1] })
    expect(await legal(matchId)).toEqual([])
    expect(await play(red, matchId, 0, 5)).toEqual({ ok: false, code: 'ILLEGAL_MOVE' })
    expect(await play(red, matchId, 0, null, true)).toEqual({ ok: true })
    const g = await game(matchId)
    expect(g.positions).toEqual({ red: [20, 56, 56, 56], yellow: [41, -1, -1, -1] })
    expect(g).toMatchObject({ turn: 'yellow', phase: 'roll' })
  })

  it('the same with 3 and 2, whichever die would make the capture; thrown for real, the count is played at once', async () => {
    const { matchId } = await table({})
    // An opponent two squares ahead (red's square 16 is yellow's square 42): the 2 would capture and lay, leaving the 3 with nowhere to go.
    await set(matchId, { dice: [3, 2], rolled: [3, 2], phase: 'roll', turn: 'red', positions: { red: [14, 56, 56, 56], yellow: [42, -1, -1, -1] } })
    // The 3 first is fine by itself (then the 2 lands past the opponent), so it is offered...
    expect(await legal(matchId)).toEqual([{ piece: 0, die: 3 }])
    // ...and so is the full count; the 2 first is not.
    await db.pg.query(`select private.ludo_settle_throw($1, false)`, [matchId])
    expect(await game(matchId)).toMatchObject({ phase: 'move', turn: 'red' })

    // With the opponent three ahead as well, neither die can go first: only the count of five.
    const second = await table({})
    await set(second.matchId, { dice: [3, 2], rolled: [3, 2], phase: 'roll', turn: 'red', positions: { red: [14, 56, 56, 56], yellow: [42, 43, -1, -1] } })
    expect(await legal(second.matchId)).toEqual([])
    await db.pg.query(`select private.ludo_settle_throw($1, false)`, [second.matchId])
    const g = await game(second.matchId)
    expect(g.positions).toEqual({ red: [19, 56, 56, 56], yellow: [42, 43, -1, -1] })
    expect(g).toMatchObject({ turn: 'yellow', phase: 'roll' })
  })

  it('with a second piece to take the other die, the capture is allowed', async () => {
    const { matchId, red } = await table({})
    await thrown(matchId, 5, 5, { red: [10, 30, 56, 56], yellow: [41, -1, -1, -1] })
    expect(await play(red, matchId, 0, 5)).toEqual({ ok: true })
    // The capturing piece laid home; the other 5 went to the piece that could use it.
    const g = await game(matchId)
    expect(g.positions).toEqual({ red: [56, 35, 56, 56], yellow: [-1, -1, -1, -1] })
  })

  it('when there is no way to play both dice, one is played and the other is lost', async () => {
    const { matchId } = await table({})
    // The piece needs exactly 2 to get home; the 5 cannot be played by anything, before or after.
    await set(matchId, { dice: [5, 2], rolled: [5, 2], phase: 'roll', turn: 'red', positions: { red: [54, 56, 56, 56], yellow: [-1, -1, -1, -1] } })
    expect(await legal(matchId)).toEqual([{ piece: 0, die: 2 }])
  })

  it('without lay the capturing piece stays on the board, so the other die can follow and the capture stands', async () => {
    const { matchId, red } = await table({ lay: false })
    await thrown(matchId, 5, 5, { red: [10, 56, 56, 56], yellow: [41, -1, -1, -1] })
    expect(await play(red, matchId, 0, 5)).toEqual({ ok: true })
    expect((await game(matchId)).positions).toEqual({ red: [20, 56, 56, 56], yellow: [-1, -1, -1, -1] })
  })

  it('the gate: the first piece out must walk the other die too, so it does not capture on the gate', async () => {
    const { matchId, red } = await table({})
    // Yellow stands on red's gate (red's square 0 is yellow's square 26). Red has nothing out.
    await thrown(matchId, 6, 3, { red: [-1, -1, -1, -1], yellow: [26, -1, -1, -1] })
    expect(await legal(matchId)).toEqual([])
    expect(await play(red, matchId, 0, 6)).toEqual({ ok: false, code: 'ILLEGAL_MOVE' })
    expect(await play(red, matchId, 0, null, true)).toEqual({ ok: true })
    // Out, and on three squares: the piece on the gate is untouched.
    expect((await game(matchId)).positions).toEqual({ red: [3, -1, -1, -1], yellow: [26, -1, -1, -1] })
  })

  it('the gate: with a piece already on the board to take the other die, the six captures on the gate', async () => {
    const { matchId, red } = await table({})
    await thrown(matchId, 6, 3, { red: [20, -1, -1, -1], yellow: [26, -1, -1, -1] })
    expect(await play(red, matchId, 1, 6)).toEqual({ ok: true })
    const g = await game(matchId)
    // The piece that came out captured on its own gate and laid home; the 3 went to the other piece.
    expect(g.positions).toEqual({ red: [23, 56, -1, -1], yellow: [-1, -1, -1, -1] })
    const [log] = await db.rows(`select die, from_progress, to_progress, captured from public.ludo_moves where match_id = $1 order by seq limit 1`, [matchId])
    expect(log).toEqual({ die: 6, from_progress: -1, to_progress: 56, captured: 1 })
  })

  it('a gate shelters nobody: landing on an opponent standing on their own gate captures', async () => {
    const { matchId, red } = await table({ lay: false })
    // Yellow's own gate is red's square 26: red lands there and yellow goes back to the yard.
    await set(matchId, { dice: [4], rolled: [4, 1], phase: 'move', die: 4, turn: 'red', positions: { red: [22, 56, 56, 56], yellow: [0, -1, -1, -1] } })
    await play(red, matchId, 0, 4)
    expect((await game(matchId)).positions).toEqual({ red: [26, 56, 56, 56], yellow: [-1, -1, -1, -1] })

    // With lay, the usual game: 5 and 4 thrown, several pieces out. The 5 captures on the gate
    // and that piece lays home; the 4 is then played by another piece. Nobody shares a square.
    const second = await table({ lay: true })
    await set(second.matchId, { dice: [5, 4], rolled: [5, 4], phase: 'move', turn: 'red', positions: { red: [21, 10, 56, 56], yellow: [0, 30, -1, -1] } })
    await play(second.red, second.matchId, 0, 5)
    // (The 4 has only one piece left to take it, so it is played at once.)
    expect((await game(second.matchId)).positions).toEqual({ red: [56, 14, 56, 56], yellow: [-1, 30, -1, -1] })
  })
})
