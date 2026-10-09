import type { Preferences } from '@/core/settings/settingsStore'

export type DraughtsBoardId = Preferences['draughtsBoard']
export type DraughtsPiecesId = Preferences['draughtsPieces']

export type DraughtsBoardTheme = {
  light: string
  dark: string
  /** The frame round the board. */
  frame: string
  /** Wash over the squares of the last move. */
  lastMove: string
  /** Wash over the square of the chosen piece. */
  selected: string
  /** Dot on a square a piece may go to, and the ring round a piece it would take. */
  hint: string
  /** Square numbers. */
  number: string
}

// Our own colours. Pieces only ever stand on the dark squares, so those are kept calm.
export const DRAUGHTS_BOARDS: Record<DraughtsBoardId, DraughtsBoardTheme> = {
  wood: { light: '#ecd2a6', dark: '#9a6238', frame: '#5c3317', lastMove: 'rgba(250, 226, 96, 0.5)', selected: 'rgba(250, 226, 96, 0.8)', hint: 'rgba(255, 244, 214, 0.85)', number: 'rgba(255, 240, 214, 0.75)' },
  green: { light: '#eef2dc', dark: '#4f7d46', frame: '#2c4a2a', lastMove: 'rgba(246, 222, 80, 0.5)', selected: 'rgba(246, 222, 80, 0.8)', hint: 'rgba(240, 250, 225, 0.85)', number: 'rgba(238, 246, 224, 0.75)' },
  indigo: { light: '#eef0fa', dark: '#4f5fb8', frame: '#252c66', lastMove: 'rgba(245, 183, 0, 0.5)', selected: 'rgba(245, 183, 0, 0.78)', hint: 'rgba(236, 240, 255, 0.85)', number: 'rgba(232, 236, 255, 0.75)' },
  grey: { light: '#e3e5ea', dark: '#6c7484', frame: '#353a45', lastMove: 'rgba(120, 190, 255, 0.5)', selected: 'rgba(120, 190, 255, 0.8)', hint: 'rgba(240, 244, 250, 0.85)', number: 'rgba(236, 240, 246, 0.75)' },
}
export const DRAUGHTS_BOARD_IDS = Object.keys(DRAUGHTS_BOARDS) as DraughtsBoardId[]

export type PieceColours = { top: string; side: string; edge: string; groove: string; crown: string }

// "White" and "Black" are the names of the two sides whatever the pieces look like.
export const DRAUGHTS_PIECES: Record<DraughtsPiecesId, Record<'w' | 'b', PieceColours>> = {
  classic: {
    w: { top: '#fbf4e2', side: '#cdbf9f', edge: '#8d7f5f', groove: '#d9cba9', crown: '#a8741a' },
    b: { top: '#3d3a3a', side: '#1b1919', edge: '#000000', groove: '#575252', crown: '#f0c24a' },
  },
  coral: {
    w: { top: '#fff1dc', side: '#e0c39a', edge: '#a17f4f', groove: '#ecd3ae', crown: '#b2541f' },
    b: { top: '#c7402d', side: '#84241a', edge: '#4f120c', groove: '#dc6351', crown: '#ffe2a8' },
  },
}
export const DRAUGHTS_PIECES_IDS = Object.keys(DRAUGHTS_PIECES) as DraughtsPiecesId[]
