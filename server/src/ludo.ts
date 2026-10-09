// Ludo on the game server. Ludo is different from the other games here: its rules and its dice
// live entirely in the database (public.ludo_action), which is the right place for dice. So the
// server judges nothing and holds no game. It does two things, both for speed:
//   * it carries a player's request to the database over a connection that is already open and
//     already signed in, instead of a fresh web request;
//   * it reads the game as it stands afterwards and hands it to every player at the table at
//     once, without waiting for the database's own live message to find them.
// The dice are still rolled by the database, never here and never on a phone.
import { describe, type Member } from './live.ts'

export type LudoRequest = { action: 'roll' | 'move'; piece: number | null; die: number | null; color: string | null; full: boolean; turnNo: number | null }

/** The few things the game server asks of the database for Ludo. */
export type LudoDb = {
  /** Whether this player sits at this table. */
  seated: (matchId: string, userId: string) => Promise<boolean>
  action: (matchId: string, userId: string, request: LudoRequest) => Promise<{ ok: boolean; code?: string }>
  /** The game as stored, in the database's own column names; null when there is none. */
  row: (matchId: string) => Promise<Record<string, unknown> | null>
}

const COLORS = ['red', 'green', 'yellow', 'blue']
const whole = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max

/** What a player's message asks for; null when it is not a Ludo request. */
export function ludoRequest(message: Record<string, unknown>): LudoRequest | null {
  const { action, piece, die, color, full, turn_no: turnNo } = message
  if (action !== 'roll' && action !== 'move') return null
  if (piece !== undefined && !whole(piece, 0, 3)) return null
  if (die !== undefined && !whole(die, 1, 6)) return null
  if (color !== undefined && !(typeof color === 'string' && COLORS.includes(color))) return null
  if (full !== undefined && typeof full !== 'boolean') return null
  if (turnNo !== undefined && !whole(turnNo, 0, 1_000_000)) return null
  return {
    action,
    piece: (piece as number | undefined) ?? null,
    die: (die as number | undefined) ?? null,
    color: (color as string | undefined) ?? null,
    full: (full as boolean | undefined) ?? false,
    turnNo: (turnNo as number | undefined) ?? null,
  }
}

export class LudoTables {
  private tables = new Map<string, Set<Member>>()
  private db: LudoDb

  constructor(db: LudoDb) {
    this.db = db
  }

  get live(): number {
    return this.tables.size
  }

  async join(member: Member, matchId: string): Promise<{ ok: true; ply: number } | { ok: false; code: string }> {
    if (!(await this.db.seated(matchId, member.userId))) return { ok: false, code: 'NOT_A_PLAYER' }
    const row = await this.db.row(matchId)
    if (!row) return { ok: false, code: 'GAME_NOT_FOUND' }
    let table = this.tables.get(matchId)
    if (!table) this.tables.set(matchId, (table = new Set()))
    table.add(member)
    return { ok: true, ply: typeof row.turn_no === 'number' ? row.turn_no : 0 }
  }

  leave(member: Member, matchId: string) {
    const table = this.tables.get(matchId)
    if (!table) return
    table.delete(member)
    if (table.size === 0) this.tables.delete(matchId)
  }

  /** Passes the request to the database, then tells the whole table how the game now stands. */
  async act(member: Member, matchId: string, request: LudoRequest): Promise<Record<string, unknown>> {
    const table = this.tables.get(matchId)
    if (!table?.has(member)) return { ok: false, code: 'NOT_A_PLAYER' }
    let outcome: { ok: boolean; code?: string }
    try {
      outcome = await this.db.action(matchId, member.userId, request)
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', event: 'apply_failed', game: 'ludo', match: matchId, message: describe(error) }))
      return { ok: false, code: 'SERVER_ERROR' }
    }
    if (!outcome.ok) return { ok: false, code: outcome.code ?? 'SERVER_ERROR' }

    // The game as it now stands. If it cannot be read, the request still succeeded: the app
    // hears of the change from the database itself a moment later.
    let row: Record<string, unknown> | null = null
    try {
      row = await this.db.row(matchId)
    } catch {
      row = null
    }
    if (row) for (const other of table) if (other !== member) other.send({ t: 'state', row })
    return { ok: true, ...(row ? { row } : {}) }
  }
}
