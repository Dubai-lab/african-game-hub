import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './testDb'

// Promotions ("register and play N games; the first K players get a reward"): who qualifies,
// in what order, which games count, and the note of who has been given the reward. Called the
// way the admin-api Edge Function calls them (service role).

let db: TestDb
const users: Record<string, string> = {}
type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
let n = 0

const player = async () => {
  const name = `promo${++n}`
  users[name] = await db.createUser(`${name}@example.com`, { username: name, country_code: 'RW', age_confirmed: true })
  return name
}
const service = async (sql: string, params: unknown[] = []): Promise<Json> => db.as('service_role', null, async () => (await db.rows<{ r: Json }>(`select ${sql} as r`, params))[0]!.r)

/** A finished game between two players: started so many minutes after the promotion began, and lasting so many seconds. */
async function game(a: string, b: string, startedMinutes: number, seconds = 300, type = 'chess') {
  const options = type === 'chess' ? '{"time_control":"3+2"}' : '{}'
  await db.pg.query(`select public.join_match_queue($1, $2, 0, $3, 'blitz')`, [users[a], type, options])
  const [row] = await db.rows<{ r: Json }>(`select public.join_match_queue($1, $2, 0, $3, 'blitz') as r`, [users[b], type, options])
  const id = row!.r.match_id as string
  expect(id).toBeTruthy()
  await db.pg.query(`select private.finish_match($1, 'win', $2, 'resign')`, [id, users[a]])
  await db.pg.query(`update public.matches set started_at = $2::timestamptz + make_interval(mins => $3), finished_at = $2::timestamptz + make_interval(mins => $3, secs => $4) where id = $1`, [id, START, startedMinutes, seconds])
  return id
}

const START = '2026-11-01T08:00:00Z'
const END = '2026-11-08T08:00:00Z'
const create = (over: Json = {}) => {
  const p = { name: 'First ten to play five', reward: '1000 RWF by mobile money', starts: START, ends: END, games: 3, winners: 2, types: null, fresh: true, perOpponent: 1, seconds: 60, ...over }
  return service(`public.admin_promotion_save($1, null, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [users.boss, p.name, p.reward, p.starts, p.ends, p.games, p.winners, p.types, p.fresh, p.perOpponent, p.seconds])
}
const standing = async (id: number) => {
  const board = await service(`public.admin_promotion($1)`, [id])
  return { board, of: (name: string) => board.rows.find((r: Json) => r.username === name) as Json | undefined }
}

beforeAll(async () => {
  db = await createTestDb()
  users.boss = await db.createUser('promoboss@example.com', { username: 'promoboss', country_code: 'RW', age_confirmed: true })
  await db.pg.query(`insert into public.admins (user_id) values ($1)`, [users.boss])
}, 120_000)
afterAll(async () => {
  expect(await db.integrityProblems()).toEqual([])
  await db.close()
})

describe('a promotion', () => {
  it('ranks the players who finished the needed games, in the order they got there, and names the winners', async () => {
    const [amina, bayo, chika, dayo, efua] = [await player(), await player(), await player(), await player(), await player()]
    await db.pg.query(`update public.profiles set created_at = $1::timestamptz + interval '1 minute' where id = any ($2)`, [START, [amina, bayo, chika, dayo, efua].map((u) => users[u])])
    const { id } = await create()

    // Amina plays three different people and is done at minute 35; Bayo at minute 55; Chika has two.
    await game(amina, bayo, 10)
    await game(amina, chika, 20)
    await game(amina, dayo, 30)
    await game(bayo, chika, 40)
    await game(bayo, dayo, 50)
    // Efua's third comes last of all: qualified, but too late to be one of the two winners.
    await game(efua, dayo, 60)
    await game(efua, chika, 70)
    await game(efua, bayo, 80)

    const { board, of } = await standing(id)
    expect(board.promotion).toMatchObject({ name: 'First ten to play five', reward: '1000 RWF by mobile money', games_needed: 3, winners: 2, created_by: 'promoboss' })
    expect(of(amina)).toMatchObject({ place: 1, winner: true, games: 3, opponents: 3, email: `${amina}@example.com`, paid_at: null })
    expect(new Date(of(amina)!.qualified_at).toISOString()).toBe('2026-11-01T08:35:00.000Z')
    expect(of(bayo)).toMatchObject({ place: 2, winner: true, games: 4 })
    // Dayo and Chika reached three games too, later than the first two; Efua last.
    expect(board.rows.filter((r: Json) => r.winner).map((r: Json) => r.username)).toEqual([amina, bayo])
    expect(of(efua)).toMatchObject({ winner: false, games: 3 })
    expect(of(efua)!.place).toBeGreaterThan(2)
    expect(board.qualified).toBe(5)
    // Those who qualified come first, in order.
    const places = board.rows.map((r: Json) => r.place)
    expect(places).toEqual([...places].sort((x: number, y: number) => x - y))
  })

  it('does not count the same opponent again and again, a game given up at once, a game outside the period, or a player who was here before', async () => {
    const [fola, gift, hawa, old] = [await player(), await player(), await player(), await player()]
    await db.pg.query(`update public.profiles set created_at = $1::timestamptz + interval '1 minute' where id = any ($2)`, [START, [fola, gift, hawa].map((u) => users[u])])
    await db.pg.query(`update public.profiles set created_at = $1::timestamptz - interval '30 days' where id = $2`, [START, users[old]])
    const { id } = await create({ name: 'Fair play only', games: 2, winners: 50 })

    // Two accounts playing each other five times: one game each, no more.
    for (let i = 0; i < 5; i++) await game(fola, gift, 100 + i * 10)
    let { of } = await standing(id)
    expect(of(fola)).toMatchObject({ games: 1, games_played: 5, opponents: 1, place: null, winner: false })

    // Given up after twenty seconds: played, not counted. And it does not use up the one game against Hawa.
    await game(fola, hawa, 200, 20)
    ;({ of } = await standing(id))
    expect(of(fola)).toMatchObject({ games: 1, games_played: 6 })
    await game(fola, hawa, 210)
    ;({ of } = await standing(id))
    expect(of(fola)).toMatchObject({ games: 2, opponents: 2, winner: true })
    expect(new Date(of(fola)!.qualified_at).toISOString()).toBe('2026-11-01T11:35:00.000Z')

    // The player who registered before the promotion is not in it at all, however much they play.
    await game(old, gift, 220)
    await game(old, hawa, 230)
    ;({ of } = await standing(id))
    expect(of(old)).toBeUndefined()
    // After the end: nothing.
    await game(gift, hawa, 60 * 24 * 8)
    ;({ of } = await standing(id))
    expect(of(gift)!.games_played).toBe(6)

    // The same record read by a promotion open to everyone, with three games allowed per opponent.
    const open = await create({ name: 'Open to all', games: 2, winners: 50, fresh: false, perOpponent: 3 })
    const all = await standing(open.id)
    expect(all.of(old)).toMatchObject({ games: 2, winner: true })
    expect(all.of(gift)!.games).toBe(4)

    // What our team sees of one player: each game, who it was against, and whether it counts.
    const games = (await service(`public.admin_promotion_player($1, $2)`, [id, users[fola]])) as unknown as Json[]
    expect(games).toHaveLength(7)
    expect(games.map((g) => g.counted)).toEqual([true, false, false, false, false, false, true])
    expect(games[0]).toMatchObject({ game_type: 'chess', seconds: 300, won: true, nth: 1, against: [{ username: gift }] })
    expect(games[5]).toMatchObject({ seconds: 20, counted: false, nth: null })
  })

  it('counts only the games it names, when it names any', async () => {
    const [idris, jomo, kofi] = [await player(), await player(), await player()]
    await db.pg.query(`update public.profiles set created_at = $1::timestamptz + interval '1 minute' where id = any ($2)`, [START, [idris, jomo, kofi].map((u) => users[u])])
    const { id } = await create({ name: 'Draughts week', games: 1, winners: 3, types: ['draughts'] })
    await game(idris, jomo, 300)
    expect((await standing(id)).of(idris)).toBeUndefined()
    expect(await create({ name: 'A game that is not', types: ['tiddlywinks'] })).toEqual({ ok: false, code: 'BAD_REQUEST' })
  })

  it('must make sense, can be changed, and is listed with how many have qualified', async () => {
    expect(await create({ name: 'x' })).toEqual({ ok: false, code: 'BAD_REQUEST' })
    expect(await create({ ends: START })).toEqual({ ok: false, code: 'BAD_REQUEST' })
    expect(await create({ games: 0 })).toEqual({ ok: false, code: 'BAD_REQUEST' })
    expect(await create({ winners: 0 })).toEqual({ ok: false, code: 'BAD_REQUEST' })

    const { id } = await create({ name: 'To be changed', games: 50 })
    expect(await service(`public.admin_promotion_save($1, $2, 'Changed', null, $3, $4, 40, 7, null, false, 2, 30)`, [users.boss, id, START, END])).toEqual({ ok: true, id })
    expect((await standing(id)).board.promotion).toMatchObject({ name: 'Changed', reward: null, games_needed: 40, winners: 7, new_players_only: false, max_per_opponent: 2, min_seconds: 30 })
    expect(await service(`public.admin_promotion_save($1, 999999, 'Nowhere', null, $2, $3, 1, 1, null, true, 1, 60)`, [users.boss, START, END])).toEqual({ ok: false, code: 'PROMOTION_NOT_FOUND' })
    expect(await service(`public.admin_promotion(999999)`)).toBeNull()

    const listed = await service(`public.admin_promotions(50, 0)`)
    expect(listed.total).toBe(listed.rows.length)
    expect(listed.rows.find((r: Json) => r.name === 'First ten to play five')).toMatchObject({ qualified: 5, paid: 0, games_needed: 3, winners: 2 })
    expect(await db.rows(`select 1 from private.admin_audit_log where action in ('promotion_created', 'promotion_changed') and admin_id = $1`, [users.boss])).not.toHaveLength(0)
  })
})

describe('the note of who has been given the reward', () => {
  it('a winner is marked once; a player who is not a winner cannot be; the note can be taken back', async () => {
    const listed = await service(`public.admin_promotions(50, 0)`)
    const id = listed.rows.find((r: Json) => r.name === 'First ten to play five').id as number
    const { board } = await standing(id)
    const [first, second] = board.rows as Json[]
    const late = board.rows.find((r: Json) => r.place === 3) as Json

    expect(await service(`public.admin_promotion_mark_paid($1, $2, $3, true, 'MoMo 0788 000 000')`, [users.boss, id, first!.user_id])).toEqual({ ok: true, place: 1 })
    expect(await service(`public.admin_promotion_mark_paid($1, $2, $3, true, null)`, [users.boss, id, first!.user_id])).toEqual({ ok: false, code: 'ALREADY_PAID' })
    expect(await service(`public.admin_promotion_mark_paid($1, $2, $3, true, null)`, [users.boss, id, late.user_id])).toEqual({ ok: false, code: 'NOT_A_WINNER' })
    expect(await service(`public.admin_promotion_mark_paid($1, $2, $3, true, null)`, [users.boss, id, users.boss])).toEqual({ ok: false, code: 'NOT_A_WINNER' })
    expect(await service(`public.admin_promotion_mark_paid($1, 999999, $2, true, null)`, [users.boss, first!.user_id])).toEqual({ ok: false, code: 'PROMOTION_NOT_FOUND' })

    const after = await standing(id)
    expect(after.board.paid).toBe(1)
    expect(after.of(first!.username)).toMatchObject({ paid_note: 'MoMo 0788 000 000', paid_by: 'promoboss' })
    expect(after.of(first!.username)!.paid_at).not.toBeNull()
    expect(after.of(second!.username)!.paid_at).toBeNull()

    expect(await service(`public.admin_promotion_mark_paid($1, $2, $3, false, 'Marked by mistake')`, [users.boss, id, first!.user_id])).toEqual({ ok: true })
    expect(await service(`public.admin_promotion_mark_paid($1, $2, $3, false, null)`, [users.boss, id, first!.user_id])).toEqual({ ok: false, code: 'NOT_MARKED_PAID' })
    expect((await standing(id)).board.paid).toBe(0)
    // No tokens moved for any of it.
    expect(await db.rows(`select 1 from public.ledger_entries where entry_type not in ('signup_bonus')`)).toEqual([])
  })

  it('no player can read a promotion, set one up, or mark anyone paid', async () => {
    const lina = await player()
    for (const sql of [
      `select * from public.promotions`,
      `select * from public.promotion_payouts`,
      `select public.admin_promotions(10, 0)`,
      `select public.admin_promotion(1)`,
      `select public.admin_promotion_player(1, '${users[lina]}')`,
      `select public.admin_promotion_save('${users[lina]}', null, 'Mine', null, now(), now() + interval '1 day', 1, 1, null, true, 1, 60)`,
      `select public.admin_promotion_mark_paid('${users[lina]}', 1, '${users[lina]}', true, null)`,
      `insert into public.promotion_payouts (promotion_id, user_id, paid_by) values (1, '${users[lina]}', '${users[lina]}')`,
    ]) {
      await expect(db.as('authenticated', users[lina]!, () => db.pg.query(sql))).rejects.toThrow(/permission denied/)
      await expect(db.as('anon', null, () => db.pg.query(sql))).rejects.toThrow(/permission denied/)
    }
  })
})
