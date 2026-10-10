import { describe, expect, it } from 'vitest'
import type { Applied, Member } from './live.ts'
import { type LudoDb, ludoRequest, LudoTables } from './ludo.ts'
import { type PoolContext, type PoolDb, PoolGames, poolRequest, type PoolRow } from './pool.ts'

// Pool and Ludo on the game server, with stand-ins for the database. (How moves are ordered,
// taken back and caught up with is shared code, tested with chess.)

function player(userId: string) {
  const heard: Record<string, unknown>[] = []
  const member: Member = { userId, send: (message) => heard.push(message) }
  return { member, heard }
}

describe('pool on the game server', () => {
  function fakeDb() {
    const row: PoolRow = { variant: '9ball', balls: [], turn: '1', break_shot: true, ball_in_hand: true, solids_seat: null, fouls: { '1': 0, '2': 0 }, shot_no: 0, phase: 'play', shot_seconds: 30 }
    const seats: Record<string, string> = { one: '1', two: '2' }
    const recorded: Record<string, unknown>[] = []
    const db: PoolDb = {
      context: async (_match, userId): Promise<PoolContext | null> => (seats[userId] ? { status: row.phase === 'over' ? 'finished' : 'active', seat: seats[userId]!, ply: row.shot_no, row: { ...row } } : null),
      applyShot: async (shot): Promise<Applied> => {
        if (shot.shotNo !== row.shot_no) return { ok: false, code: 'OUT_OF_SYNC' }
        const state = shot.state as { balls: unknown; turn: string; breakShot: boolean; ballInHand: boolean; solidsSeat: string | null; fouls: [number, number] }
        Object.assign(row, { balls: state.balls, turn: state.turn, break_shot: state.breakShot, ball_in_hand: state.ballInHand, solids_seat: state.solidsSeat, fouls: { '1': state.fouls[0], '2': state.fouls[1] }, shot_no: row.shot_no + 1 })
        recorded.push(shot)
        return { ok: true }
      },
    }
    return { db, row, recorded }
  }
  const breakShot = { dx: 1_000_000, dy: 0, power: 1000, spinX: 0, spinY: 0 }

  it('plays a shot out, shows the opponent everything needed to replay it, and records the same table', async () => {
    const { db, row, recorded } = fakeDb()
    const games = new PoolGames(db)
    const one = player('one')
    const two = player('two')
    expect(await games.join(one.member, 'm1')).toEqual({ ok: true, ply: 0 })
    await games.join(two.member, 'm1')

    const answer = await games.move(one.member, 'm1', 0, breakShot)
    expect(answer.ok).toBe(true)
    const told = two.heard[0] as { t: string; ply: number; seat: string; shot: unknown; from: { n: number }[]; state: { balls: { n: number; x: number; y: number }[]; turn: string }; deadline: string }
    expect(told).toMatchObject({ t: 'move', ply: 1, seat: '1', shot: breakShot })
    expect(told.from).toHaveLength(10)
    expect(Date.parse(told.deadline)).toBeGreaterThan(Date.now() + 25_000)
    // What the opponent was shown is exactly what the database stored.
    expect(told.state.balls).toEqual(row.balls)
    expect(row.shot_no).toBe(1)
    // Stored to a thousandth of a millimetre, as the Edge Function stores it.
    expect(told.state.balls.every((b) => Math.round(b.x * 1000) / 1000 === b.x && Math.round(b.y * 1000) / 1000 === b.y)).toBe(true)
    expect((recorded[0]!.state as { from: unknown[] }).from).toHaveLength(10)
  })

  it('goes by whose turn the table says it is, not by taking turns', async () => {
    const { db } = fakeDb()
    const games = new PoolGames(db)
    const one = player('one')
    const two = player('two')
    await games.join(one.member, 'm1')
    await games.join(two.member, 'm1')
    expect(await games.move(two.member, 'm1', 0, breakShot)).toEqual({ ok: false, code: 'NOT_YOUR_TURN' })
    const first = await games.move(one.member, 'm1', 0, breakShot)
    const toShoot = (two.heard[0] as { state: { turn: string } }).state.turn
    const [next, waiting] = toShoot === '1' ? [one, two] : [two, one]
    expect(first.ok).toBe(true)
    expect(await games.move(waiting.member, 'm1', 1, { ...breakShot, power: 300 })).toEqual({ ok: false, code: 'NOT_YOUR_TURN' })
    expect((await games.move(next.member, 'm1', 1, { ...breakShot, power: 300, cue: { x: 600, y: 600 } })).code).not.toBe('NOT_YOUR_TURN')
  })

  it('catches up when the shot clock has moved the game on in the database', async () => {
    const { db, row } = fakeDb()
    const games = new PoolGames(db)
    const one = player('one')
    const two = player('two')
    await games.join(one.member, 'm1')
    await games.join(two.member, 'm1')
    // The database took the turn from seat 1 for running out of time.
    Object.assign(row, { turn: '2', shot_no: 1 })
    expect(await games.move(one.member, 'm1', 0, breakShot)).toEqual({ ok: false, code: 'OUT_OF_SYNC' })
    expect((await games.move(two.member, 'm1', 1, breakShot)).ok).toBe(true)
  })

  it('reads a shot strictly: whole numbers only, nothing missing', () => {
    expect(poolRequest({ shot: breakShot })).toEqual(breakShot)
    expect(poolRequest({ shot: { ...breakShot, cue: { x: 10.5, y: 20 }, pocket: 3 } })).toEqual({ ...breakShot, cue: { x: 10.5, y: 20 }, pocket: 3 })
    expect(poolRequest({ shot: { ...breakShot, power: 10.5 } })).toBeNull()
    expect(poolRequest({ shot: { dx: 1, dy: 1 } })).toBeNull()
    expect(poolRequest({ shot: { ...breakShot, cue: { x: 'a', y: 1 } } })).toBeNull()
    expect(poolRequest({})).toBeNull()
  })
})

describe('Ludo on the game server', () => {
  function fakeDb() {
    const state = { turn_no: 3, refuse: null as string | null, asked: [] as unknown[] }
    const db: LudoDb = {
      table: async (_match, userId) => (userId === 'stranger' ? null : { turn_no: state.turn_no, turn: 'red', phase: 'move' }),
      action: async (_match, userId, request) => {
        state.asked.push({ userId, ...request })
        if (state.refuse) return { ok: false, code: state.refuse }
        state.turn_no++
        return { ok: true }
      },
    }
    return { db, state }
  }

  it('lets the players at the table in, and nobody else', async () => {
    const { db } = fakeDb()
    const tables = new LudoTables(db)
    expect(await tables.join(player('red').member, 'm1')).toEqual({ ok: true, ply: 3 })
    expect(await tables.join(player('stranger').member, 'm1')).toEqual({ ok: false, code: 'NOT_A_PLAYER' })
    expect(tables.live).toBe(1)
  })

  it('carries a request to the database and hands the new state to the whole table', async () => {
    const { db, state } = fakeDb()
    const tables = new LudoTables(db)
    const red = player('red')
    const green = player('green')
    const blue = player('blue')
    for (const who of [red, green, blue]) await tables.join(who.member, 'm1')

    const request = ludoRequest({ action: 'roll', turn_no: 3 })!
    expect(await tables.act(red.member, 'm1', request)).toEqual({ ok: true, row: { turn_no: 4, turn: 'red', phase: 'move' } })
    expect(state.asked).toEqual([{ userId: 'red', action: 'roll', piece: null, die: null, color: null, full: false, turnNo: 3 }])
    for (const other of [green, blue]) expect(other.heard).toEqual([{ t: 'state', row: { turn_no: 4, turn: 'red', phase: 'move' } }])
    // The player who asked is told by the answer, not twice.
    expect(red.heard).toEqual([])
  })

  it('passes on the database’s refusal and tells nobody else', async () => {
    const { db, state } = fakeDb()
    const tables = new LudoTables(db)
    const red = player('red')
    const green = player('green')
    await tables.join(red.member, 'm1')
    await tables.join(green.member, 'm1')
    state.refuse = 'NOT_YOUR_TURN'
    expect(await tables.act(green.member, 'm1', ludoRequest({ action: 'move', piece: 1, die: 6, color: 'green', turn_no: 3 })!)).toEqual({ ok: false, code: 'NOT_YOUR_TURN' })
    expect(red.heard).toEqual([])
    expect(await tables.act(player('stranger').member, 'm1', ludoRequest({ action: 'roll' })!)).toEqual({ ok: false, code: 'NOT_A_PLAYER' })
  })

  it('reads a request strictly, and never accepts anything but rolling and moving', () => {
    expect(ludoRequest({ action: 'move', piece: 2, die: 5, color: 'blue', full: true, turn_no: 9 })).toEqual({ action: 'move', piece: 2, die: 5, color: 'blue', full: true, turnNo: 9 })
    expect(ludoRequest({ action: 'resign' })).toBeNull()
    expect(ludoRequest({ action: 'move', piece: 4 })).toBeNull()
    expect(ludoRequest({ action: 'move', die: 7 })).toBeNull()
    expect(ludoRequest({ action: 'move', color: 'pink' })).toBeNull()
  })
})
