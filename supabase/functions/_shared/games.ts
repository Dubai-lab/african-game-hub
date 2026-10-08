// The server-side half of each game module, as far as the shared core needs it: checking the
// options a player asked for and saying which rating pool they belong to. The core's matchmaking
// function knows nothing about any particular game; it asks here.
//
// Adding a game: add an entry below (and its private.<game>_init_match / _on_finish functions
// in a migration).

export type QueueChoice = {
  /** Options in a fixed shape, so two players who chose the same thing compare equal. */
  options: Record<string, unknown>
  ratingPool: string
  /** How many players the match needs. Two unless the game says otherwise. */
  players?: number
}

type GameAdapter = {
  /** Null when the options are not on offer. */
  queueChoice: (optionsSchema: unknown, requested: Record<string, unknown>) => QueueChoice | null
}

type TimeControl = { id: string; base_ms: number; increment_ms: number }

function chessTimeControls(optionsSchema: unknown): TimeControl[] {
  const list = (optionsSchema as { time_controls?: unknown } | null)?.time_controls
  if (!Array.isArray(list)) return []
  return list.filter(
    (c): c is TimeControl =>
      typeof c?.id === 'string' && Number.isInteger(c?.base_ms) && c.base_ms > 0 && Number.isInteger(c?.increment_ms) && c.increment_ms >= 0,
  )
}

const chess: GameAdapter = {
  queueChoice: (optionsSchema, requested) => {
    const control = chessTimeControls(optionsSchema).find((c) => c.id === requested.time_control)
    if (!control) return null
    // Standard pacing, from the expected length of a 40-move game (same rule as the app).
    const seconds = (control.base_ms + 40 * control.increment_ms) / 1000
    const ratingPool = seconds < 180 ? 'bullet' : seconds < 600 ? 'blitz' : 'rapid'
    return { options: { time_control: control.id }, ratingPool }
  },
}

const ludo: GameAdapter = {
  queueChoice: (optionsSchema, requested) => {
    const modes = (optionsSchema as { modes?: unknown } | null)?.modes
    const mode = Array.isArray(modes) ? modes.find((m) => typeof m?.id === 'string' && m.id === requested.mode) : undefined
    const sizes = (optionsSchema as { players?: unknown } | null)?.players
    const players = requested.players === undefined ? 2 : requested.players
    // Two dice unless the player asked for one.
    const counts = (optionsSchema as { dice?: unknown } | null)?.dice
    const dice = requested.dice === undefined ? 2 : requested.dice
    if (!mode || !Array.isArray(sizes) || !sizes.includes(players) || !Array.isArray(counts) || !counts.includes(dice)) return null
    // Both sides (two houses each) is the usual two-player game; bigger tables are one house each.
    const sides = players === 2 ? (requested.sides === undefined ? 2 : requested.sides) : 1
    if (sides !== 1 && sides !== 2) return null
    // Lay (a capturing piece goes straight home) unless the player switched it off.
    const lay = requested.lay === undefined ? true : requested.lay
    if (typeof lay !== 'boolean') return null
    // One standing for Ludo, whatever the choices.
    return { options: { mode: mode.id, players, dice, sides, lay }, ratingPool: 'default', players: players as number }
  },
}

const pool: GameAdapter = {
  queueChoice: (optionsSchema, requested) => {
    const variants = (optionsSchema as { variants?: unknown } | null)?.variants
    if (!Array.isArray(variants) || !variants.includes(requested.variant)) return null
    // 8-ball and 9-ball are different games, each with its own rating.
    return { options: { variant: requested.variant }, ratingPool: requested.variant === '9ball' ? 'nine_ball' : 'eight_ball' }
  },
}

export const games: Record<string, GameAdapter> = { chess, ludo, pool }
