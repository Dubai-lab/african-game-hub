// Live games, as the game server holds them. The same handling serves every game that is
// played move by move with White (seat 1) first: chess and draughts so far. Each game supplies
// its own rules and its own database functions (see chess.ts, draughts.ts).
//
// What this is for: speed. A move sent to an Edge Function travels a long way and waits for
// several things before the opponent hears of it. Here both players hold an open connection,
// the game is in memory, and a legal move is passed to the opponent the moment it is judged.
//
// What this is NOT: a second authority. The database remains the game.
//   * Every move is still recorded by the game's own database function, the same one its Edge
//     Function uses: under a row lock, on the database's own clock, settling the match when it
//     ends. Money is never touched here.
//   * A move is shown to the opponent a moment before the database has confirmed it. If the
//     database then says no (the mover's time ran out, the game ended meanwhile), both players
//     are told to take it back and reload.
//   * If this server stops, nothing is lost: whatever was confirmed is in the database, and the
//     app falls back to the Edge Functions until the server returns.

export type Color = 'w' | 'b'

/** What every game's stored context says, whatever else it carries. */
export type Stored = { status: string; color: Color; ply: number }

export type Applied =
  | { ok: true; ply: number; white_time_ms: number; black_time_ms: number; last_move_at: string; finished: boolean }
  | { ok: false; code: string }

/** A move judged legal: the position after it, what to tell the players, and how to record it. */
export type Judged<S> = {
  ok: true
  state: S
  /** The move as the players are told it (for chess `{san}`, for draughts `{path}`). */
  told: Record<string, unknown>
  record: (matchId: string, userId: string, expectedPly: number) => Promise<Applied>
}

/** One game's rules and storage, as the live handling needs them. */
export type GameKind<C extends Stored, S, R> = {
  /** The stored game as one player sees it; null when they are not in the match. */
  context: (matchId: string, userId: string) => Promise<C | null>
  /** The position to play from. Null when the stored record does not hold together. */
  open: (stored: C) => S | null
  /** Tries a move. `CORRUPT_GAME` makes the server read the game again. */
  judge: (state: S, request: R) => Judged<S> | { ok: false; code: string }
}

/** One player's connection, as far as a game is concerned. */
export type Member = { userId: string; send: (message: Record<string, unknown>) => void }

type Room<S> = {
  matchId: string
  /** The position, including a move that is on its way to the database. Null: unreadable record. */
  state: S | null
  /** How many moves have been played, counting that one. */
  ply: number
  over: boolean
  members: Map<Member, Color>
  /** Moves in one game are handled strictly one after another. */
  tail: Promise<unknown>
}

export class LiveGames<C extends Stored, S, R> {
  private rooms = new Map<string, Room<S>>()
  private kind: GameKind<C, S, R>
  private name: string

  constructor(name: string, kind: GameKind<C, S, R>) {
    this.name = name
    this.kind = kind
  }

  /** Games with at least one player connected. */
  get live(): number {
    return this.rooms.size
  }

  /** Waits until every move already accepted has been answered (used when shutting down). */
  async idle(): Promise<void> {
    await Promise.allSettled([...this.rooms.values()].map((room) => room.tail))
  }

  private take(room: Room<S>, stored: C) {
    room.state = this.kind.open(stored)
    room.ply = stored.ply
    room.over = stored.status !== 'active'
    if (room.state === null) console.error(JSON.stringify({ level: 'error', event: 'corrupt_game', game: this.name, match: room.matchId }))
  }

  /**
   * A player arrives at their game. Answers with how many moves the server holds, so the app
   * can tell at once whether its own picture is behind.
   */
  async join(member: Member, matchId: string): Promise<{ ok: true; ply: number } | { ok: false; code: string }> {
    const stored = await this.kind.context(matchId, member.userId)
    if (!stored) return { ok: false, code: 'NOT_A_PLAYER' }
    let room = this.rooms.get(matchId)
    if (!room) {
      room = { matchId, state: null, ply: 0, over: false, members: new Map(), tail: Promise.resolve() }
      this.rooms.set(matchId, room)
      this.take(room, stored)
    } else {
      // Wait for any move in hand, then believe the database if it knows more than we do
      // (a move made through the Edge Function while this player was away).
      await room.tail.catch(() => undefined)
      if (stored.ply > room.ply || stored.status !== 'active') this.take(room, stored)
    }
    room.members.set(member, stored.color)
    return { ok: true, ply: room.ply }
  }

  leave(member: Member, matchId: string) {
    const room = this.rooms.get(matchId)
    if (!room) return
    room.members.delete(member)
    // Nothing is kept for a game nobody is connected to: it is read again when someone returns.
    if (room.members.size === 0) this.rooms.delete(matchId)
  }

  /** A player asks to move. Resolves with what to tell them. */
  move(member: Member, matchId: string, ply: number, request: R): Promise<Applied & Record<string, unknown>> {
    const room = this.rooms.get(matchId)
    if (!room || !room.members.has(member)) return Promise.resolve({ ok: false, code: 'NOT_A_PLAYER' })
    const run = room.tail.catch(() => undefined).then(() => this.play(room, member, ply, request))
    room.tail = run
    return run
  }

  private others(room: Room<S>, member: Member, message: Record<string, unknown>) {
    for (const other of room.members.keys()) if (other !== member) other.send(message)
  }

  /** Reads the game again from the database. */
  private async resync(room: Room<S>, userId: string): Promise<void> {
    try {
      const stored = await this.kind.context(room.matchId, userId)
      if (stored) this.take(room, stored)
    } catch {
      // Left as it was; the next request tries again.
    }
  }

  private async play(room: Room<S>, member: Member, ply: number, request: R): Promise<Applied & Record<string, unknown>> {
    const color = room.members.get(member)
    if (!color) return { ok: false, code: 'NOT_A_PLAYER' }

    // The app and the server disagree about how far the game has got: one of them missed
    // something. Ask the database before answering.
    if (ply !== room.ply || room.state === null) await this.resync(room, member.userId)
    if (room.over) return { ok: false, code: 'GAME_OVER' }
    if (room.state === null) return { ok: false, code: 'CORRUPT_GAME' }
    if (ply !== room.ply) return { ok: false, code: 'OUT_OF_SYNC' }
    // White (seat 1) plays the first move and every other one after it.
    if ((room.ply % 2 === 0 ? 'w' : 'b') !== color) return { ok: false, code: 'NOT_YOUR_TURN' }

    const verdict = this.kind.judge(room.state, request)
    if (!verdict.ok) {
      if (verdict.code === 'CORRUPT_GAME') {
        console.error(JSON.stringify({ level: 'error', event: 'corrupt_game', game: this.name, match: room.matchId }))
        await this.resync(room, member.userId)
      }
      return verdict
    }

    // Legal: the opponent sees it now. The database is asked at the same moment.
    const before = { state: room.state, ply: room.ply }
    room.state = verdict.state
    room.ply = before.ply + 1
    this.others(room, member, { t: 'move', ply: room.ply, ...verdict.told })

    let applied: Applied
    try {
      applied = await verdict.record(room.matchId, member.userId, before.ply)
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', event: 'apply_failed', game: this.name, match: room.matchId, message: String(error) }))
      applied = { ok: false, code: 'SERVER_ERROR' }
    }

    if (!applied.ok) {
      // The move did not happen. Go back to what the database holds, and say so to both.
      room.state = before.state
      room.ply = before.ply
      await this.resync(room, member.userId)
      this.others(room, member, { t: 'revert', ply: before.ply + 1 })
      return applied
    }

    if (applied.finished) room.over = true
    this.others(room, member, { t: 'clock', ply: applied.ply, white_time_ms: applied.white_time_ms, black_time_ms: applied.black_time_ms, last_move_at: applied.last_move_at })
    return { ...applied, ...verdict.told }
  }
}
