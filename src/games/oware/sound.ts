// Oware is seeds dropped into a wooden board, so it is heard the way the hub's other wooden
// games are: the hub's own recordings of wood (see ASSETS.md), with the synthesised version
// underneath them.
import { feedback as play, preloadChessSounds } from '@/games/chess/sound/sounds'

export type OwareSound = 'move' | 'capture' | 'gameStart' | 'gameEnd' | 'lowTime' | 'illegal'

export const feedback = (name: OwareSound) => play(name)
export const preloadSounds = preloadChessSounds
