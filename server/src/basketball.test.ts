import { describe, expect, it } from 'vitest'
import { encodeInput, NO_INPUT, RIM } from '../../supabase/functions/_shared/basketball.ts'
import { type BasketballDb, BasketballCourts, type CourtContext, GONE_MS, START_WITHIN_MS } from './basketball.ts'
import type { Member } from './live.ts'

// Street basketball on the game server, with a stand-in for the database: the court opens when
// every player is there, runs on the buttons it is sent, sends the court to everyone, and gives
// the database the result once.

function player(userId: string) {
  const heard: Record<string, any>[] = [] // eslint-disable-line @typescript-eslint/no-explicit-any
  const member: Member = { userId, send: (message) => heard.push(message) }
  return { member, heard }
}

function fakeDb(size: 1 | 2 = 1) {
  const seats = size === 1 ? { one: 'a1', two: 'b1' } : { one: 'a1', two: 'a2', three: 'b1', four: 'b2' }
  const finished: unknown[][] = []
  const aborted: unknown[][] = []
  const alive: string[] = []
  const db: BasketballDb = {
    context: async (_match, userId): Promise<CourtContext | null> =>
      userId in seats
        ? {
            status: finished.length || aborted.length ? 'finished' : 'active',
            team_size: size,
            seed: 7,
            seat: seats[userId as keyof typeof seats] ?? null,
            players: Object.entries(seats).map(([user_id, seat]) => ({ user_id, seat, username: user_id, country_code: 'RW' })),
          }
        : null,
    alive: async (matchId) => void alive.push(matchId),
    finish: async (...args) => {
      finished.push(args)
      return { ok: true }
    },
    abort: async (...args) => void aborted.push(args),
  }
  return { db, finished, aborted, alive }
}

/** Runs the courts on for `seconds` of game time from `start`, in small steps. Returns the time reached. */
function runFor(courts: BasketballCourts, start: number, seconds: number) {
  let now = start
  for (let t = 0; t < seconds * 1000; t += 16) courts.run((now += 16))
  return now
}

describe('basketball on the game server', () => {
  it('starts when everyone is there, and sends the court to all of them', async () => {
    const { db, alive } = fakeDb()
    const courts = new BasketballCourts(db)
    const one = player('one')
    const two = player('two')
    expect(await courts.join(one.member, 'm1', 0)).toEqual({ ok: true, ply: 0 })
    expect(one.heard[0]).toMatchObject({ t: 'court', you: 0, size: 1, started: false })
    courts.run(100)
    expect(one.heard.some((m) => m.t === 'start')).toBe(false)
    await courts.join(two.member, 'm1', 200)
    expect(two.heard[0]).toMatchObject({ t: 'court', you: 1 })
    runFor(courts, 200, 2)
    for (const heard of [one.heard, two.heard]) {
      expect(heard.some((m) => m.t === 'start')).toBe(true)
      expect(heard.filter((m) => m.t === 'state').length).toBeGreaterThan(20)
    }
    expect(alive).toContain('m1')
  })

  it('refuses someone who is not in the match', async () => {
    const courts = new BasketballCourts(fakeDb().db)
    expect(await courts.join(player('stranger').member, 'm1', 0)).toEqual({ ok: false, code: 'NOT_A_PLAYER' })
  })

  it('moves a player by the buttons they send, and ignores anything malformed', async () => {
    const courts = new BasketballCourts(fakeDb().db)
    const one = player('one')
    const two = player('two')
    await courts.join(one.member, 'm1', 0)
    await courts.join(two.member, 'm1', 0)
    let now = runFor(courts, 0, 1.5)
    const before = one.heard.filter((m) => m.t === 'state').at(-1)!.s.p[0]
    courts.input(one.member, 'm1', { t: 'in', i: encodeInput({ ...NO_INPUT, mx: 1 }) })
    courts.input(one.member, 'm1', { t: 'in', i: 'nonsense' })
    courts.input(two.member, 'm1', { t: 'in', i: [0, 0, 99] })
    now = runFor(courts, now, 1)
    const after = one.heard.filter((m) => m.t === 'state').at(-1)!.s.p[0]
    expect(after[0]).toBeGreaterThan(before[0] + 1)
  })

  it('a game played out goes to the database once, with the score', async () => {
    const { db, finished } = fakeDb()
    const courts = new BasketballCourts(db)
    const one = player('one')
    const two = player('two')
    await courts.join(one.member, 'm1', 0)
    await courts.join(two.member, 'm1', 0)
    let now = runFor(courts, 0, 0.1)
    // Player one stands under the basket and dunks, again and again; player two does nothing.
    const held = encodeInput({ ...NO_INPUT, shoot: true })
    const free = encodeInput(NO_INPUT)
    for (let i = 0; i < 4000 && finished.length === 0; i++) {
      const state = one.heard.filter((m) => m.t === 'state').at(-1)?.s
      const mine = state?.b[6] === 0
      if (mine) {
        const [x, z] = state.p[0]
        const toward = { mx: RIM.x - x, mz: RIM.z + 0.8 - z }
        const d = Math.hypot(toward.mx, toward.mz)
        courts.input(one.member, 'm1', { t: 'in', i: d > 0.6 ? encodeInput({ ...NO_INPUT, mx: toward.mx / d, mz: toward.mz / d }) : i % 2 ? held : free })
      } else courts.input(one.member, 'm1', { t: 'in', i: free })
      now = runFor(courts, now, 0.05)
    }
    expect(finished).toHaveLength(1)
    expect(finished[0]![1]).toBe('a')
    expect(finished[0]![2]).toBeGreaterThanOrEqual(11)
    expect(finished[0]![4]).toBe('played')
    runFor(courts, now, 2)
    expect(finished).toHaveLength(1)
    expect(one.heard.some((m) => m.t === 'over' && m.winner === 0)).toBe(true)
  }, 60_000)

  it('a player away too long loses the match for their side; one back in time does not', async () => {
    const { db, finished } = fakeDb(2)
    const courts = new BasketballCourts(db)
    const [one, two, three, four] = ['one', 'two', 'three', 'four'].map(player)
    for (const p of [one, two, three, four]) await courts.join(p!.member, 'm1', 0)
    let now = runFor(courts, 0, 1)
    courts.leave(three!.member, 'm1', now)
    now = runFor(courts, now, (GONE_MS / 1000) * 0.5)
    const back = player('three')
    await courts.join(back.member, 'm1', now)
    now = runFor(courts, now, 1)
    expect(finished).toHaveLength(0)
    courts.leave(one!.member, 'm1', now)
    runFor(courts, now, GONE_MS / 1000 + 1)
    expect(finished).toHaveLength(1)
    expect(finished[0]![1]).toBe('b')
    expect(finished[0]![4]).toBe('abandoned')
  })

  it('calls the match off when not everyone comes, and when the server stops', async () => {
    const first = fakeDb()
    const courts = new BasketballCourts(first.db)
    await courts.join(player('one').member, 'm1', 0)
    runFor(courts, 0, START_WITHIN_MS / 1000 + 1)
    expect(first.aborted).toEqual([['m1', 'no_show']])

    const second = fakeDb()
    const other = new BasketballCourts(second.db)
    await other.join(player('one').member, 'm2', 0)
    await other.join(player('two').member, 'm2', 0)
    runFor(other, 0, 1)
    await other.idle()
    expect(second.aborted).toEqual([['m2', 'server_lost']])
    expect(other.live).toBe(0)
  })
})
