// The computer thinks here, off the main thread, so the board stays smooth while it does.
import type { Board, Color } from '../../../supabase/functions/_shared/draughts'
import { chooseMove, type Level } from './computer'

type Request = { id: number; board: Board; turn: Color; level: Level }

self.onmessage = (event: MessageEvent<Request>) => {
  const { id, board, turn, level } = event.data
  self.postMessage({ id, path: chooseMove(board, turn, level) })
}
