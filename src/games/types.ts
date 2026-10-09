import type { ComponentType, LazyExoticComponent } from 'react'

/** A game's own choices for a match (for chess: the time control). The core treats it as opaque. */
export type GameOptions = Record<string, unknown>

export type LobbyOptionsProps = {
  /** `game_types.options_schema` for this game, straight from the database. */
  schema: unknown
  value: GameOptions | null
  onChange: (value: GameOptions) => void
}

/**
 * What a game module gives the shared core on the client. The lobby never knows what a
 * "time control" is: it asks the module for a picker and passes the chosen options along.
 * (The parts for playing a match — board, moves, result — are added to this in later steps.)
 */
export type GameModule = {
  id: string
  /** The first sensible choice, or null when the schema offers nothing. */
  defaultOptions: (schema: unknown) => GameOptions | null
  /** Whether saved options are still on offer (the registry can change between visits). */
  isValidOptions: (schema: unknown, value: GameOptions | null) => boolean
  /**
   * Which rating a match with these options counts toward (for chess: bullet, blitz or rapid).
   * Must be one of the game's `rating_pools` in the registry. The server decides the real pool
   * when a match is made; this is for showing the right rating beforehand.
   */
  ratingPool: (schema: unknown, value: GameOptions | null) => string
  OptionsPicker: ComponentType<LobbyOptionsProps>
  /** The screen for playing (or replaying) one match of this game. Loaded only when opened. */
  MatchScreen: LazyExoticComponent<ComponentType<{ matchId: string }>>
  /** What a player of this game is shown by in the lobby and the rankings: a rating number (the default) or games won. */
  standing?: 'rating' | 'wins'
  /** How many players a match with these options has. Two when the module does not say. */
  players?: (schema: unknown, value: GameOptions | null) => number
  /** Ways to play this game without an opponent or tokens (for chess: the computer, or two players on one phone). */
  practice?: { to: string; labelKey: string }[]
  /** A short name for a set of options, for lists of invitations and tournaments ("5 | 3", "9-ball"). */
  optionsLabel?: (schema: unknown, value: GameOptions | null) => string
  /** This game's part of the Settings page (for chess: board colours and pieces), if it has one. */
  SettingsSection?: LazyExoticComponent<ComponentType>
}
