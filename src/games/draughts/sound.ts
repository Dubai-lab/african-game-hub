// Draughts is wooden pieces on a wooden board, as chess is, so it is heard the same way: the
// hub's own recordings of wood (see ASSETS.md), with the synthesised version underneath them.
import { feedback as play, preloadChessSounds } from '@/games/chess/sound/sounds'

export type DraughtsSound = 'move' | 'capture' | 'promote' | 'gameStart' | 'gameEnd' | 'lowTime' | 'illegal'

export const feedback = (name: DraughtsSound) => play(name)
export const preloadSounds = preloadChessSounds
