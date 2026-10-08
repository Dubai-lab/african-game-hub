import type { BoardThemeId } from '@/core/settings/settingsStore'

export type BoardTheme = {
  light: string
  dark: string
  /** Wash over the two squares of the last move. */
  lastMove: string
  /** Wash over the selected square. */
  selected: string
  /** Legal-move dot and capture ring. */
  hint: string
}

// Our own colours. "indigo" is the house board from the landing page.
export const BOARD_THEMES: Record<BoardThemeId, BoardTheme> = {
  indigo: { light: '#eef0fa', dark: '#6b7bd6', lastMove: 'rgba(245, 183, 0, 0.5)', selected: 'rgba(245, 183, 0, 0.72)', hint: 'rgba(13, 17, 48, 0.3)' },
  green: { light: '#eef2dc', dark: '#6f9a52', lastMove: 'rgba(246, 222, 80, 0.55)', selected: 'rgba(246, 222, 80, 0.8)', hint: 'rgba(20, 40, 15, 0.3)' },
  wood: { light: '#ecd2a6', dark: '#a8734a', lastMove: 'rgba(250, 226, 96, 0.5)', selected: 'rgba(250, 226, 96, 0.78)', hint: 'rgba(50, 26, 8, 0.32)' },
  grey: { light: '#e3e5ea', dark: '#8b92a1', lastMove: 'rgba(120, 190, 255, 0.5)', selected: 'rgba(120, 190, 255, 0.78)', hint: 'rgba(15, 20, 35, 0.3)' },
}

export const BOARD_THEME_IDS = Object.keys(BOARD_THEMES) as BoardThemeId[]
