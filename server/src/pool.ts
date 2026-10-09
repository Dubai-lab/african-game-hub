// Pool on the game server. A shot is played out here with the same physics and rules file the
// Edge Function and the app use (supabase/functions/_shared/pool.ts), shown to the opponent at
// once, and recorded by public.pool_apply_shot. See live.ts for how a move is handled.
//
// The shot clock stays with the database: when it takes a turn away, the stored game moves on
// without this server, which notices on the next shot (the shot numbers no longer match) and
// reads the game again.
import { applyShot, type Ball, type PoolState, rack, type Seat, type Shot, type Variant } from '../../supabase/functions/_shared/pool.ts'
import { type Applied, type GameKind, LiveGames, type Stored } from './live.ts'

/** The stored game, as the database holds it. */
export type PoolRow = {
  variant: string
  balls: unknown
  turn: string
  break_shot: boolean
  ball_in_hand: boolean
  solids_seat: string | null
  fouls: unknown
  shot_no: number
  phase: string
  shot_seconds: number
}
export type PoolContext = Stored & { row: PoolRow }

/** The few things the game server asks of the database for pool. */
export type PoolDb = {
  context: (matchId: string, userId: string) => Promise<PoolContext | null>
  /** Records a shot already played out. The database re-checks whose turn it is and the shot number. */
  applyShot: (shot: { matchId: string; userId: string; shotNo: number; state: Record<string, unknown>; shot: Shot; result: Record<string, unknown> }) => Promise<Applied>
}

type Table = PoolState & { shotSeconds: number }

const whole = (value: unknown) => typeof value === 'number' && Number.isInteger(value)
/** The shot a player's message asks for; null when it is not a shot at all. */
export function poolRequest(message: Record<string, unknown>): Shot | null {
  const shot = message.shot as Record<string, unknown> | null
  if (typeof shot !== 'object' || shot === null) return null
  if (![shot.dx, shot.dy, shot.power, shot.spinX, shot.spinY].every(whole)) return null
  const cue = shot.cue as { x?: unknown; y?: unknown } | undefined
  if (cue !== undefined && (typeof cue !== 'object' || cue === null || typeof cue.x !== 'number' || typeof cue.y !== 'number' || !Number.isFinite(cue.x) || !Number.isFinite(cue.y))) return null
  if (shot.pocket !== undefined && !whole(shot.pocket)) return null
  return {
    dx: shot.dx as number,
    dy: shot.dy as number,
    power: shot.power as number,
    spinX: shot.spinX as number,
    spinY: shot.spinY as number,
    ...(cue ? { cue: { x: cue.x as number, y: cue.y as number } } : {}),
    ...(shot.pocket !== undefined ? { pocket: shot.pocket as number } : {}),
  }
}

// Positions are stored to a thousandth of a millimetre, and the next shot is played from
// exactly what is stored. The server keeps the same rounded positions, so it and the database
// never differ by a hair.
const tidy = (balls: Ball[]): Ball[] => balls.map((b) => ({ n: b.n, x: Math.round(b.x * 1000) / 1000, y: Math.round(b.y * 1000) / 1000, in: b.in }))

const kind = (db: PoolDb): GameKind<PoolContext, Table, Shot> => ({
  context: db.context,
  open: ({ row }) => {
    if (row.variant !== '8ball' && row.variant !== '9ball') return null
    const variant = row.variant as Variant
    const stored = (row.balls as Ball[] | null) ?? []
    const fouls = (row.fouls as Record<string, number> | null) ?? {}
    return {
      variant,
      // Until the break, the table is the rack.
      balls: stored.length > 0 ? stored : rack(variant),
      turn: Number(row.turn) as Seat,
      breakShot: row.break_shot,
      ballInHand: row.ball_in_hand,
      solidsSeat: row.solids_seat ? (Number(row.solids_seat) as Seat) : null,
      fouls: [fouls['1'] ?? 0, fouls['2'] ?? 0],
      shotSeconds: row.shot_seconds,
    }
  },
  turn: (table) => String(table.turn),
  judge: (table, shot) => {
    const played = applyShot(table, shot)
    if (!played) return { ok: false, code: 'ILLEGAL_SHOT' }

    const balls = tidy(played.state.balls)
    // Where the cue ball stood when the shot was struck (after any placement), for playing it back.
    const from = tidy(table.balls).map((b) => (b.n === 0 && table.ballInHand && shot.cue ? { ...b, x: shot.cue.x, y: shot.cue.y, in: false } : b))
    const state = {
      balls,
      turn: String(played.state.turn),
      breakShot: played.state.breakShot,
      ballInHand: played.state.ballInHand,
      solidsSeat: played.state.solidsSeat === null ? null : String(played.state.solidsSeat),
      fouls: played.state.fouls,
    }
    const result = { ...played.result, winner: played.result.winner === null ? null : String(played.result.winner) }
    const finished = played.result.winner !== null
    return {
      ok: true,
      state: { ...played.state, balls, shotSeconds: table.shotSeconds },
      finished,
      // Everything the opponent's screen needs to play the shot back and show the table after
      // it. The deadline is this server's reckoning; the database's own follows a moment later.
      told: { seat: String(table.turn), shot, result, from, state, deadline: finished ? null : new Date(Date.now() + table.shotSeconds * 1000).toISOString() },
      record: (matchId, userId, shotNo) => db.applyShot({ matchId, userId, shotNo, state: { ...state, from }, shot, result }),
    }
  },
})

export class PoolGames extends LiveGames<PoolContext, Table, Shot> {
  constructor(db: PoolDb) {
    super('pool', kind(db))
  }
}
