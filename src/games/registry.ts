import { chessModule } from './chess/lobby'
import { draughtsModule } from './draughts/lobby'
import { ludoModule } from './ludo/lobby'
import { poolModule } from './pool/lobby'
import type { GameModule } from './types'

// Adding a game: write its module, then add one line here (and a row in the game_types table).
const modules: Record<string, GameModule> = {
  [chessModule.id]: chessModule,
  [ludoModule.id]: ludoModule,
  [poolModule.id]: poolModule,
  [draughtsModule.id]: draughtsModule,
}

export function getGameModule(gameId: string): GameModule | undefined {
  return modules[gameId]
}
