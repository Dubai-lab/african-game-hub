// Live chess games, as the game server holds them.
//
// What this is for: speed. A move sent to an Edge Function travels a long way and waits for
// several things before the opponent hears of it. Here both players hold an open connection,
// the game is in memory, and a legal move is passed to the opponent the moment it is judged.
//
// What this is NOT: a second authority. The database remains the game.
//   * Every move is still recorded by public.chess_apply_move, the same function the Edge
//     Function uses: under a row lock, on the database's own clock, settling the match when it
//     ends. Money is never touched here.
//   * A move is shown to the opponent a moment before the database has confirmed it. If the
//     database then says no (the mover's time ran out, the game ended meanwhile), both players
//     are told to take it back and reload.
//   * If this server stops, nothing is lost: whatever was confirmed is in the database, and the
//     app falls back to the Edge Functions until the server returns.
import { judgeMove } from '../../supabase/functions/_shared/chessRules.ts'

export type Color = 'w' | 'b'

export type ChessContext = { status: string; color: Color; fen: string; ply: number; turn: Color; sans: string[] }
export type Applied =
  | { ok: true; ply: number; white_time_ms: number; black_time_ms: number; last_move_at: string; finished: boolean }
  | { ok: false; code: string }

/** The few things the game server asks of the database. */
export type ChessDb = {
  /** The stored game as one player sees it; null when they are not in the match. */
  context: (matchId: string, userId: string) => Promise<ChessContext | null>
  /** Records a move already judged legal. The database re-checks turn, position and clock. */
  applyMove: (move: {
    matchId: string
    userId: string
    expectedPly: number
    san: string
    uci: string
    fenAfter: string
    endReason: string | null
    winner: Color | null
  }) => Promise<Applied>
}

/** One player's connection, as far as a game is concerned. */
export type Member = { userId: string; send: (message: Record<string, unknown>) => void }

type Room = {
  matchId: string
  /** Every move so far, including one that is on its way to the database. */
  sans: string[]
  fen: string
  over: boolean
  members: Map<Member, Color>
  /** Moves in one game are handled strictly one after another. */
  tail: Promise<unknown>
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export class ChessGames {
  private rooms = new Map<string, Room>()
  private db: ChessDb

  constructor(db: ChessDb) {
    this.db = db
  }

  /** Games with at least one player connected. */
  get live(): number {
    return this.rooms.size
  }

  /** Waits until every move already accepted has been answered (used when shutting down). */
  async idle(): Promise<void> {
    await Promise.allSettled([...this.rooms.values()].map((room) => room.tail))
  }

  private take(room: Room, stored: ChessContext) {
    room.sans = stored.sans
    room.fen = stored.fen
    room.over = stored.status !== 'active'
  }

  /**
   * A player arrives at their game. Answers with how many moves the server holds, so the app
   * can tell at once whether its own picture is behind.
   */
  async join(member: Member, matchId: string): Promise<{ ok: true; ply: number } | { ok: false; code: string }> {
    const stored = await this.db.context(matchId, member.userId)
    if (!stored) return { ok: false, code: 'NOT_A_PLAYER' }
    let room = this.rooms.get(matchId)
    if (!room) {
      room = { matchId, sans: [], fen: START_FEN, over: false, members: new Map(), tail: Promise.resolve() }
      this.rooms.set(matchId, room)
      this.take(room, stored)
    } else {
      // Wait for any move in hand, then believe the database if it knows more than we do
      // (a move made through the Edge Function while this player was away).
      await room.tail.catch(() => undefined)
      if (stored.ply > room.sans.length || stored.status !== 'active') this.take(room, stored)
    }
    room.members.set(member, stored.color)
    return { ok: true, ply: room.sans.length }
  }

  leave(member: Member, matchId: string) {
    const room = this.rooms.get(matchId)
    if (!room) return
    room.members.delete(member)
    // Nothing is kept for a game nobody is connected to: it is read again when someone returns.
    if (room.members.size === 0) this.rooms.delete(matchId)
  }

  /** A player asks to move. Resolves with what to tell them. */
  move(member: Member, matchId: string, request: { uci: string; ply: number }): Promise<Applied & { san?: string }> {
    const room = this.rooms.get(matchId)
    if (!room || !room.members.has(member)) return Promise.resolve({ ok: false, code: 'NOT_A_PLAYER' })
    const run = room.tail.catch(() => undefined).then(() => this.play(room, member, request))
    room.tail = run
    return run
  }

  private others(room: Room, member: Member, message: Record<string, unknown>) {
    for (const other of room.members.keys()) if (other !== member) other.send(message)
  }

  /** Reads the game again from the database. False when that was not possible. */
  private async resync(room: Room, userId: string): Promise<boolean> {
    try {
      const stored = await this.db.context(room.matchId, userId)
      if (!stored) return false
      this.take(room, stored)
      return true
    } catch {
      return false
    }
  }

  private async play(room: Room, member: Member, request: { uci: string; ply: number }): Promise<Applied & { san?: string }> {
    const color = room.members.get(member)
    if (!color) return { ok: false, code: 'NOT_A_PLAYER' }

    // The app and the server disagree about how far the game has got: one of them missed
    // something. Ask the database before answering.
    if (request.ply !== room.sans.length) await this.resync(room, member.userId)
    if (room.over) return { ok: false, code: 'GAME_OVER' }
    if (request.ply !== room.sans.length) return { ok: false, code: 'OUT_OF_SYNC' }
    if ((room.sans.length % 2 === 0 ? 'w' : 'b') !== color) return { ok: false, code: 'NOT_YOUR_TURN' }

    const verdict = judgeMove(room.sans, room.fen, request.uci)
    if (!verdict.ok) {
      if (verdict.code === 'CORRUPT_GAME') {
        console.error(JSON.stringify({ level: 'error', event: 'chess_corrupt', match: room.matchId }))
        await this.resync(room, member.userId)
      }
      return { ok: false, code: verdict.code }
    }

    // Legal: the opponent sees it now. The database is asked at the same moment.
    const before = { sans: room.sans, fen: room.fen }
    const ply = room.sans.length + 1
    room.sans = [...room.sans, verdict.san]
    room.fen = verdict.fenAfter
    this.others(room, member, { t: 'move', ply, san: verdict.san })

    let applied: Applied
    try {
      applied = await this.db.applyMove({
        matchId: room.matchId,
        userId: member.userId,
        expectedPly: ply - 1,
        san: verdict.san,
        uci: verdict.uci,
        fenAfter: verdict.fenAfter,
        endReason: verdict.endReason,
        winner: verdict.winner,
      })
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', event: 'chess_apply_failed', match: room.matchId, message: String(error) }))
      applied = { ok: false, code: 'SERVER_ERROR' }
    }

    if (!applied.ok) {
      // The move did not happen. Go back to what the database holds, and say so to both.
      room.sans = before.sans
      room.fen = before.fen
      await this.resync(room, member.userId)
      this.others(room, member, { t: 'revert', ply })
      return applied
    }

    if (applied.finished) room.over = true
    const clocks = { ply: applied.ply, white_time_ms: applied.white_time_ms, black_time_ms: applied.black_time_ms, last_move_at: applied.last_move_at }
    this.others(room, member, { t: 'clock', ...clocks })
    return { ...applied, san: verdict.san }
  }
}
