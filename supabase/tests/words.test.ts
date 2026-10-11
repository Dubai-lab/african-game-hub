import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { act, ALL_TILES, EMPTY_BOARD, isSound, type Judge, type Laid, leave, type Played, timeout, type WordsState } from '../functions/_shared/words'
import { createTestDb, type TestDb } from './testDb'

// Word Battle in the database: the deal, who may see which tiles, recording a position only on
// top of the one it was worked out from, and how every ending reaches the core and the wallets.
// The rules themselves are tested in src/games/words/rules.test.ts; here each request is worked
// out the way the words-action function does it (read the whole game, apply the rules, record
// the result).

let db: TestDb
const users: Record<string, string> = {}
type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
let n = 0

const WORDS = new Set(['cat', 'cats', 'at', 'as', 'scat', 'act'])
const judge: Judge = { isWord: (word) => WORDS.has(word), random: () => 0.5 }
type Context = { status: string; seat: string | null; late: boolean; state: WordsState }
const context = async (matchId: string, user: string) => (await db.rows<{ r: Context | null }>(`select public.words_context($1, $2) as r`, [matchId, users[user]]))[0]!.r
const store = async (matchId: string, expected: number, played: Extract<Played, { ok: true }>): Promise<Json> =>
  (await db.rows<{ r: Json }>(`select public.words_store($1, $2, $3, $4) as r`, [matchId, expected, JSON.stringify(played.state), JSON.stringify(played.event)]))[0]!.r
/** What the function does for one request, start to finish. */
async function request(matchId: string, user: string, work: (state: WordsState, seat: string) => Played): Promise<Json> {
  const game = (await context(matchId, user))!
  if (game.status !== 'active') return { ok: false, code: 'GAME_OVER' }
  const played = work(game.state, game.seat!)
  if (!played.ok) return played
  return store(matchId, game.state.moveNo, played)
}
const table = async (matchId: string) => (await db.rows<Json>(`select * from public.words_games where match_id = $1`, [matchId]))[0]!
const match = async (matchId: string) =>
  (await db.rows<{ status: string; result: string | null; end_reason: string | null; winner_id: string | null; settled: boolean }>(
    `select status, result, end_reason, winner_id, settled from public.matches where id = $1`, [matchId]))[0]!
const wallet = async (user: string) => (await db.rows<{ total: number }>(`select (bonus_balance + cash_balance)::int as total from public.wallets where user_id = $1`, [users[user]]))[0]!.total
const read = <T = Json>(user: string, sql: string, params: unknown[] = []) => db.as('authenticated', users[user]!, () => db.rows<T>(sql, params))
const lay = (word: string, row: number, col: number): Laid[] => [...word].map((letter, i) => ({ row, col: col + i, letter }))

/** A new game between this many players. Returns their names by seat ('1' plays first). */
async function newGame(players = 2, stake = 0) {
  n++
  const names = Array.from({ length: players }, (_, i) => `w${n}p${i + 1}`)
  for (const name of names) users[name] = await db.createUser(`${name}@example.com`, { username: name, country_code: 'NG', age_confirmed: true })
  let matchId = ''
  for (const name of names) {
    const [row] = await db.rows<{ r: Json }>(`select public.join_match_queue($1, 'words', $2, $3, 'default', $4) as r`, [users[name], stake, JSON.stringify({ players }), players])
    matchId = (row!.r.match_id as string | undefined) ?? matchId
  }
  const seats = await db.rows<{ user_id: string; seat: string }>(`select user_id, seat from public.match_players where match_id = $1`, [matchId])
  const by: Record<string, string> = {}
  for (const row of seats) by[row.seat] = names.find((name) => users[name] === row.user_id)!
  return { matchId, by }
}
/** Puts the stored game into a given position, as a real game would have left it. */
async function arrange(matchId: string, racks: Record<string, string>, bag: string, extra: Json = {}) {
  for (const [seat, tiles] of Object.entries(racks)) await db.pg.query(`update public.words_racks set tiles = $3 where match_id = $1 and seat = $2`, [matchId, seat, [...tiles]])
  await db.pg.query(`update public.words_bags set tiles = $2 where match_id = $1`, [matchId, [...bag]])
  const fields: Json = { counts: JSON.stringify(Object.fromEntries(Object.entries(racks).map(([s, t]) => [s, t.length]))), bag_count: bag.length, ...extra }
  await db.pg.query(`update public.words_games set ${Object.keys(fields).map((k, i) => `${k} = $${i + 2}`).join(', ')} where match_id = $1`, [matchId, ...Object.values(fields)])
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

describe('the bag and the deal', () => {
  it('the database holds the same hundred tiles as the rule book', async () => {
    const rows = await db.rows<{ tiles: string[] }>(`select private.words_all_tiles() as tiles`)
    expect([...rows[0]!.tiles].sort()).toEqual([...ALL_TILES].sort())
  })

  it('draws seven tiles each from the whole bag onto an empty board, for two, three and four players', async () => {
    for (const players of [2, 3, 4]) {
      const { matchId, by } = await newGame(players)
      const game = (await context(matchId, by['1']!))!
      expect(game).toMatchObject({ status: 'active', seat: '1' })
      expect(game.state.seats).toEqual(['1', '2', '3', '4'].slice(0, players))
      for (const seat of game.state.seats) expect(game.state.racks[seat]).toHaveLength(7)
      expect(game.state.bag).toHaveLength(100 - players * 7)
      expect(game.state.board).toBe(EMPTY_BOARD)
      expect(isSound(game.state)).toBe(true)
      expect([...Object.values(game.state.racks).flat(), ...game.state.bag].sort()).toEqual([...ALL_TILES].sort())
      expect(await table(matchId)).toMatchObject({ counts: Object.fromEntries(game.state.seats.map((s) => [s, 7])), bag_count: 100 - players * 7, turn: '1', move_no: 0, phase: 'play' })
    }
  })

  it('shuffles: two games are not dealt the same', async () => {
    const a = (await context((await newGame()).matchId, `w${n}p1`))!.state
    const b = (await context((await newGame()).matchId, `w${n}p1`))!.state
    expect(a.bag).not.toEqual(b.bag)
  })
})

describe('who may see what', () => {
  it('a player reads their own rack and nobody else’s; nobody reads the bag', async () => {
    const { matchId, by } = await newGame(3)
    const mine = await read<{ seat: string; tiles: string[] }>(by['1']!, `select seat, tiles from public.words_racks where match_id = $1`, [matchId])
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ seat: '1' })
    expect(mine[0]!.tiles).toHaveLength(7)
    expect(await read(by['2']!, `select 1 from public.words_racks where match_id = $1 and seat = '1'`, [matchId])).toEqual([])
    await expect(read(by['1']!, `select 1 from public.words_bags where match_id = $1`, [matchId])).rejects.toThrow(/permission denied/)
    expect(await read(by['2']!, `select board from public.words_games where match_id = $1`, [matchId])).toHaveLength(1)

    users.outsider = await db.createUser(`wout${n}@example.com`, { username: `wout${n}`, country_code: 'NG', age_confirmed: true })
    expect(await read('outsider', `select 1 from public.words_games where match_id = $1`, [matchId])).toEqual([])
    expect(await read('outsider', `select 1 from public.words_racks where match_id = $1`, [matchId])).toEqual([])
    expect(await context(matchId, 'outsider')).toBeNull()
  })

  it('no player can write a tile, a board or a bag, or call the server’s functions', async () => {
    const { matchId, by } = await newGame()
    const player = by['1']!
    for (const sql of [
      `update public.words_racks set tiles = '{q,z}' where match_id = '${matchId}'`,
      `update public.words_games set scores = '{"1": 999, "2": 0}' where match_id = '${matchId}'`,
      `update public.words_bags set tiles = '{}' where match_id = '${matchId}'`,
      `delete from public.words_racks where match_id = '${matchId}'`,
    ]) {
      await db.as('authenticated', users[player]!, () => db.pg.query(sql)).catch(() => undefined)
    }
    const game = (await context(matchId, player))!
    expect(game.state.racks['1']).toHaveLength(7)
    expect(game.state.scores).toEqual({ '1': 0, '2': 0 })
    expect(game.state.bag).toHaveLength(86)
    await expect(read(player, `select public.words_context($1, $2)`, [matchId, users[player]])).rejects.toThrow(/permission denied/)
    await expect(read(player, `select public.words_store($1, 0, '{}', '{}')`, [matchId])).rejects.toThrow(/permission denied/)
  })
})

describe('recording a turn', () => {
  it('a word laid is recorded with its score, and the rack is drawn back up from the bag', async () => {
    const { matchId, by } = await newGame()
    await arrange(matchId, { '1': 'catqzxy', '2': 'aeiouas' }, 'eeeio')
    expect(await request(matchId, by['1']!, (state, seat) => act(state, seat, { type: 'place', tiles: lay('cat', 7, 6) }, judge))).toMatchObject({ ok: true, move_no: 1 })
    const after = await table(matchId)
    expect(after).toMatchObject({ scores: { '1': 10, '2': 0 }, counts: { '1': 7, '2': 7 }, bag_count: 2, turn: '2', move_no: 1 })
    expect(after.board.slice(7 * 15 + 6, 7 * 15 + 9)).toBe('cat')
    expect(after.last_event).toMatchObject({ seat: '1', kind: 'place', score: 10, words: [{ word: 'cat', score: 10 }] })
    // The tiles drawn are the player's alone to see.
    expect((await context(matchId, by['1']!))!.state.racks['1']).toEqual(['q', 'z', 'x', 'y', 'o', 'i', 'e'])
    expect(JSON.stringify(after.last_event)).not.toContain('"o"')
  })

  it('a turn worked out on an old picture of the game is not recorded', async () => {
    const { matchId, by } = await newGame()
    await arrange(matchId, { '1': 'catacts', '2': 'aeiouas' }, 'eeeeeeeee')
    const game = (await context(matchId, by['1']!))!
    const first = act(game.state, '1', { type: 'place', tiles: lay('cat', 7, 6) }, judge) as Extract<Played, { ok: true }>
    const second = act(game.state, '1', { type: 'place', tiles: lay('act', 7, 6) }, judge) as Extract<Played, { ok: true }>
    expect(await store(matchId, 0, first)).toMatchObject({ ok: true })
    expect(await store(matchId, 0, second)).toEqual({ ok: false, code: 'OUT_OF_SYNC' })
    expect((await table(matchId)).scores).toEqual({ '1': 10, '2': 0 })
  })

  it('a position with a tile too many, or with a tile on the board moved, is refused outright', async () => {
    const { matchId, by } = await newGame()
    await arrange(matchId, { '1': 'catqzxy', '2': 'aeiouas' }, 'eeeio')
    const game = (await context(matchId, by['1']!))!
    const extra = { ...game.state, racks: { ...game.state.racks, '1': [...game.state.racks['1']!, 'z'] } }
    await expect(store(matchId, 0, { ok: true, state: extra, event: { seat: '1', kind: 'pass' } })).rejects.toThrow(/WORDS_BAD_POSITION/)

    expect(await request(matchId, by['1']!, (state, seat) => act(state, seat, { type: 'place', tiles: lay('cat', 7, 6) }, judge))).toMatchObject({ ok: true })
    // The c that is down is swapped for a tile from the second player's rack: not allowed.
    const later = (await context(matchId, by['2']!))!
    const squares = [...later.state.board]
    squares[7 * 15 + 6] = 'a'
    const moved = { ...later.state, board: squares.join(''), racks: { ...later.state.racks, '2': ['e', 'i', 'o', 'u', 'a', 's', 'c'] } }
    await expect(store(matchId, 1, { ok: true, state: moved, event: { seat: '2', kind: 'pass' } })).rejects.toThrow(/WORDS_BAD_POSITION/)
    expect((await table(matchId)).move_no).toBe(1)
  })
})

describe('how a game ends, and what the wallets show', () => {
  it('going out wins the pot less the fee, and the racks are shown', async () => {
    const { matchId, by } = await newGame(2, 100)
    const before = { one: await wallet(by['1']!), two: await wallet(by['2']!) }
    await arrange(matchId, { '1': 'cat', '2': 'qz' }, '')
    expect(await request(matchId, by['1']!, (state, seat) => act(state, seat, { type: 'place', tiles: lay('cat', 7, 6) }, judge))).toMatchObject({ ok: true })
    expect(await match(matchId)).toMatchObject({ status: 'finished', result: 'win', end_reason: 'finished', winner_id: users[by['1']!], settled: true })
    const done = await table(matchId)
    expect(done.phase).toBe('over')
    // 10 for cat, plus the q and z the other player was left holding; they lose the same.
    expect(done.result).toMatchObject({ reason: 'finished', winner: '1', scores: { '1': 30, '2': -20 }, racks: { '1': [], '2': ['q', 'z'] } })
    expect(await wallet(by['1']!)).toBe(before.one + 180)
    expect(await wallet(by['2']!)).toBe(before.two)
    expect(await request(matchId, by['2']!, (state, seat) => act(state, seat, { type: 'pass' }, judge))).toEqual({ ok: false, code: 'GAME_OVER' })
  })

  it('two rounds without a score end it; level scores are a draw and every stake goes back', async () => {
    const { matchId, by } = await newGame(2, 100)
    const before = { one: await wallet(by['1']!), two: await wallet(by['2']!) }
    await arrange(matchId, { '1': 'a', '2': 'e' }, 'iiiiiiii')
    for (const seat of ['1', '2', '1', '2']) expect(await request(matchId, by[seat]!, (state, s) => act(state, s, { type: 'pass' }, judge))).toMatchObject({ ok: true })
    expect(await match(matchId)).toMatchObject({ status: 'finished', result: 'draw', end_reason: 'stalled', winner_id: null, settled: true })
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
    expect(await table(three.matchId)).toMatchObject({ out_seats: ['1'], turn: '2', counts: { '1': 0, '2': 7, '3': 7 } })
  })
})

describe('the turn clock', () => {
  it('a turn that has run out is passed when any player asks, by the database’s own clock', async () => {
    const { matchId, by } = await newGame()
    expect((await context(matchId, by['2']!))!.late).toBe(false)
    await db.pg.query(`update public.words_games set deadline = clock_timestamp() - interval '1 second' where match_id = $1`, [matchId])
    expect((await context(matchId, by['2']!))!.late).toBe(true)
    expect(await request(matchId, by['2']!, (state) => timeout(state, judge))).toMatchObject({ ok: true })
    const after = await table(matchId)
    expect(after).toMatchObject({ turn: '2', missed: { '1': 1, '2': 0 }, scoreless: 1 })
    expect(after.last_event).toEqual({ seat: '1', kind: 'timeout' })
    expect((await context(matchId, by['2']!))!.late).toBe(false)
  })

  it('if nobody is there to ask, the sweep puts the late player out after a further wait', async () => {
    const three = await newGame(3)
    await db.pg.query(`update public.words_games set deadline = clock_timestamp() - interval '5 seconds' where match_id = $1`, [three.matchId])
    await db.pg.exec(`select private.sweep()`)
    expect((await table(three.matchId)).out_seats).toEqual([])
    await db.pg.query(`update public.words_games set deadline = clock_timestamp() - interval '30 seconds' where match_id = $1`, [three.matchId])
    await db.pg.exec(`select private.sweep()`)
    expect(await table(three.matchId)).toMatchObject({ out_seats: ['1'], turn: '2', counts: { '1': 0, '2': 7, '3': 7 }, phase: 'play' })
    expect(isSound((await context(three.matchId, three.by['2']!))!.state)).toBe(true)

    const two = await newGame(2, 50)
    await db.pg.query(`update public.words_games set deadline = clock_timestamp() - interval '30 seconds' where match_id = $1`, [two.matchId])
    await db.pg.exec(`select private.sweep()`)
    expect(await match(two.matchId)).toMatchObject({ status: 'finished', result: 'win', end_reason: 'last_standing', winner_id: users[two.by['2']!], settled: true })
  })
})
