import type { SearchLimits } from './stockfish'

export type LevelId = 'beginner' | 'easy' | 'medium' | 'hard' | 'expert' | 'master'

export type Level = SearchLimits & {
  id: LevelId
  /**
   * Chance of playing a random legal move instead of the engine's choice. Even at its weakest
   * setting Stockfish beats a newcomer every time, so the two easiest levels also make honest
   * mistakes.
   */
  randomMoveChance: number
}

export const LEVELS: Level[] = [
  { id: 'beginner', skill: 0, depth: 1, moveTimeMs: 300, randomMoveChance: 0.4 },
  { id: 'easy', skill: 1, depth: 2, moveTimeMs: 400, randomMoveChance: 0.18 },
  { id: 'medium', skill: 5, depth: 5, moveTimeMs: 600, randomMoveChance: 0 },
  { id: 'hard', skill: 10, depth: 8, moveTimeMs: 900, randomMoveChance: 0 },
  { id: 'expert', skill: 15, depth: 12, moveTimeMs: 1300, randomMoveChance: 0 },
  { id: 'master', skill: 20, depth: 18, moveTimeMs: 2000, randomMoveChance: 0 },
]

export const DEFAULT_LEVEL: LevelId = 'easy'

export function levelById(id: string | null | undefined): Level {
  return LEVELS.find((level) => level.id === id) ?? LEVELS.find((level) => level.id === DEFAULT_LEVEL)!
}

/** Splits an engine move such as "e7e8q" into its parts. */
export function parseUciMove(uci: string): { from: string; to: string; promotion?: 'q' | 'r' | 'b' | 'n' } | null {
  const match = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(uci)
  if (!match) return null
  return { from: match[1]!, to: match[2]!, promotion: match[3] as 'q' | 'r' | 'b' | 'n' | undefined }
}
