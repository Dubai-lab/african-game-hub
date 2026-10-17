// Street basketball on the game server: here the server is not a messenger but the court
// itself (CLAUDE.md, section 2: real-time games run on the game server alone).
//
// It runs each match with the rules every player has in practice
// (supabase/functions/_shared/basketball.ts), sixty times a second, from the buttons the players
// press, and sends each of them the court about fifteen times a second. It decides baskets and
// the score; the phones only draw what they are sent. The result goes to the database once,
// through public.basketball_finish, which settles the match like any other.
//
// A match begins when every player has arrived (or is called off if they have not, in time). A
// player who goes away comes back to the same match; one away for too long loses it for their
// side. If this server stops, its matches cannot be carried on anywhere else: they are called
// off (and the database calls off any it stops hearing about).
import {
  decodeInput,
  type Game,
  type GameEvent,
  type Input,
  newGame,
  NO_INPUT,
  snapshot,
  step,
  TICK,
  type Team,
} from '../../supabase/functions/_shared/basketball.ts'
import { describe, type Member } from './live.ts'

export type CourtPlayer = { user_id: string; seat: string; username: string; country_code: string | null }
export type CourtContext = { status: string; team_size: 1 | 2; seed: number; seat: string | null; players: CourtPlayer[] }

export type BasketballDb = {
  context: (matchId: string, userId: string) => Promise<CourtContext | null>
  alive: (matchId: string, started: boolean) => Promise<unknown>
  finish: (matchId: string, side: 'a' | 'b', scoreA: number, scoreB: number, reason: 'played' | 'abandoned') => Promise<{ ok: boolean; code?: string }>
  abort: (matchId: string, reason: 'no_show' | 'server_lost') => Promise<unknown>
}

const TICK_MS = TICK * 1000
/** Every player must be on court this long after the first arrives, or the match is called off. */
export const START_WITHIN_MS = 45_000
/** A player away this long in the middle of a match loses it for their side. */
export const GONE_MS = 25_000
/** The court goes to the players every this many ticks (fifteen times a second). */
const SEND_EVERY = 4
/** How often the database is told the match is still being played. */
const ALIVE_EVERY_MS = 15_000
/** How long a finished match stays, for players reconnecting to see how it ended. */
const KEEP_MS = 30_000
/** More buttons waiting than this from one player: the oldest are dropped. */
const MAX_QUEUED = 12

type Court = {
  matchId: string
  game: Game
  /** Each user's player in the game. */
  ids: Map<string, number>
  players: CourtPlayer[]
  members: Map<string, Member>
  awaySince: Map<string, number>
  queued: Map<number, Input[]>
  held: Map<number, Input>
  events: GameEvent[]
  createdAt: number
  started: boolean
  last: number
  ticks: number
  aliveAt: number
  /** The result sent to the database (or the match called off): nothing more is decided. */
  done: boolean
  doneAt: number
  finishing: boolean
}

/** A seat on a side as the player's number in the game: side a first, then side b. */
const idOf = (seat: string, size: number) => (seat[0] === 'a' ? 0 : size) + Number(seat.slice(1)) - 1
const sideOf = (team: Team) => (team === 0 ? 'a' : 'b')

export class BasketballCourts {
  private courts = new Map<string, Court>()
  /** Log lines for what went wrong, kept short. */
  log: (event: string, more?: Record<string, unknown>) => void = () => {}

  constructor(private db: BasketballDb) {}

  get live() {
    return [...this.courts.values()].filter((c) => !c.done).length
  }

  async join(member: Member, matchId: string, now = Date.now()): Promise<{ ok: true; ply: number } | { ok: false; code: string }> {
    let court = this.courts.get(matchId)
    if (!court) {
      const context = await this.db.context(matchId, member.userId)
      if (!context || !context.seat) return { ok: false, code: 'NOT_A_PLAYER' }
      if (context.status !== 'active') return { ok: false, code: 'MATCH_NOT_ACTIVE' }
      // Another player may have opened it while the database was being asked.
      court = this.courts.get(matchId) ?? this.open(matchId, context, now)
    }
    const id = court.ids.get(member.userId)
    if (id === undefined) return { ok: false, code: 'NOT_A_PLAYER' }
    court.members.set(member.userId, member)
    court.awaySince.delete(member.userId)
    const size = court.game.players.length / 2
    member.send({
      t: 'court',
      you: id,
      size,
      started: court.started,
      players: court.players.map((p) => ({ id: idOf(p.seat, size), username: p.username, country_code: p.country_code })),
      s: snapshot(court.game),
    })
    return { ok: true, ply: court.game.tick }
  }

  private open(matchId: string, context: CourtContext, now: number): Court {
    const game = newGame(context.seed, context.team_size)
    const court: Court = {
      matchId,
      game,
      ids: new Map(context.players.map((p) => [p.user_id, idOf(p.seat, context.team_size)])),
      players: context.players,
      members: new Map(),
      awaySince: new Map(),
      queued: new Map(),
      held: new Map(),
      events: [],
      createdAt: now,
      started: false,
      last: now,
      ticks: 0,
      aliveAt: now,
      done: false,
      doneAt: 0,
      finishing: false,
    }
    this.courts.set(matchId, court)
    return court
  }

  leave(member: Member, matchId: string, now = Date.now()) {
    const court = this.courts.get(matchId)
    if (!court || court.members.get(member.userId) !== member) return
    court.members.delete(member.userId)
    court.awaySince.set(member.userId, now)
    const id = court.ids.get(member.userId)
    // Gone: the player stands still until they are back.
    if (id !== undefined) {
      court.queued.delete(id)
      court.held.set(id, NO_INPUT)
    }
  }

  /** The buttons a player is pressing now. Ignored unless it is a well-formed input from a player on court. */
  input(member: Member, matchId: string, message: Record<string, unknown>) {
    const court = this.courts.get(matchId)
    if (!court || court.done || court.members.get(member.userId) !== member) return
    const id = court.ids.get(member.userId)
    const input = decodeInput(message.i)
    if (id === undefined || !input) return
    const queue = court.queued.get(id) ?? []
    queue.push(input)
    if (queue.length > MAX_QUEUED) queue.splice(0, queue.length - MAX_QUEUED)
    court.queued.set(id, queue)
  }

  /** Plays every court on to `now`. Called many times a second. */
  run(now = Date.now()) {
    for (const court of this.courts.values()) this.play(court, now)
  }

  private play(court: Court, now: number) {
    if (court.done) {
      if (now - court.doneAt > KEEP_MS) this.courts.delete(court.matchId)
      return
    }
    if (!court.started) {
      if (court.members.size === court.ids.size) {
        court.started = true
        court.last = now
        court.aliveAt = now
        this.say(court, { t: 'start' })
        void this.db.alive(court.matchId, true).catch((error) => this.log('basketball_alive_failed', { match: court.matchId, error: describe(error) }))
      } else if (now - court.createdAt > START_WITHIN_MS) {
        this.callOff(court, 'no_show', now)
      }
      return
    }

    // A side with a player away too long loses.
    for (const [userId, since] of court.awaySince) {
      if (now - since <= GONE_MS) continue
      const id = court.ids.get(userId)!
      const team = court.game.players[id]!.team
      return this.finish(court, team === 0 ? 1 : 0, 'abandoned', now)
    }

    // Sixty times a second of the game, however often this is called (at most a few ticks of
    // catching up at once, so a stalled server does not run the game at high speed after).
    let due = Math.min(6, Math.floor((now - court.last) / TICK_MS))
    if (due <= 0) return
    court.last += due * TICK_MS
    if (now - court.last > 100) court.last = now
    while (due-- > 0 && court.game.phase !== 'over') {
      const inputs = court.game.players.map((p) => {
        const next = court.queued.get(p.id)?.shift()
        if (next) court.held.set(p.id, next)
        return court.held.get(p.id) ?? NO_INPUT
      })
      step(court.game, inputs)
      court.events.push(...court.game.events)
      court.ticks++
      if (court.ticks % SEND_EVERY === 0) this.send(court)
    }

    if (court.game.phase === 'over' && court.game.winner !== null) {
      this.send(court)
      return this.finish(court, court.game.winner, 'played', now)
    }
    if (now - court.aliveAt > ALIVE_EVERY_MS) {
      court.aliveAt = now
      void this.db.alive(court.matchId, true).catch((error) => this.log('basketball_alive_failed', { match: court.matchId, error: describe(error) }))
    }
  }

  private send(court: Court) {
    this.say(court, { t: 'state', s: snapshot(court.game), e: court.events })
    court.events = []
  }

  private say(court: Court, message: Record<string, unknown>) {
    for (const member of court.members.values()) member.send(message)
  }

  /** The result to the database, once. Tried again a few times if the database cannot be reached. */
  private finish(court: Court, winner: Team, reason: 'played' | 'abandoned', now: number, attempt = 0) {
    if (court.finishing && attempt === 0) return
    court.finishing = true
    court.done = true
    court.doneAt = now
    const [a, b] = court.game.score
    this.say(court, { t: 'over', winner, reason, score: [a, b] })
    void this.db
      .finish(court.matchId, sideOf(winner), a, b, reason)
      .then((reply) => {
        if (!reply.ok) this.log('basketball_finish_refused', { match: court.matchId, code: reply.code })
      })
      .catch((error) => {
        this.log('basketball_finish_failed', { match: court.matchId, attempt, error: describe(error) })
        if (attempt < 4) setTimeout(() => this.finish(court, winner, reason, Date.now(), attempt + 1), 2000 * (attempt + 1)).unref?.()
      })
  }

  private callOff(court: Court, reason: 'no_show' | 'server_lost', now: number) {
    court.done = true
    court.doneAt = now
    this.say(court, { t: 'over', winner: null, reason })
    void this.db.abort(court.matchId, reason).catch((error) => this.log('basketball_abort_failed', { match: court.matchId, error: describe(error) }))
  }

  /** Stopping: matches being played cannot be carried on elsewhere, so they are called off now. */
  async idle(now = Date.now()) {
    const playing = [...this.courts.values()].filter((c) => !c.done)
    await Promise.all(
      playing.map(async (court) => {
        court.done = true
        court.doneAt = now
        this.say(court, { t: 'over', winner: null, reason: 'server_lost' })
        await this.db.abort(court.matchId, 'server_lost').catch(() => {})
      }),
    )
  }
}
