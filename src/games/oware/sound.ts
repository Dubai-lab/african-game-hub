// Oware is seeds dropped into a wooden board, so it is heard the way the hub's other wooden
// games are: the hub's own recordings of wood (see ASSETS.md), with the synthesised version
// underneath them.
import { buzz, feedback as play, playSound, preloadChessSounds } from '@/games/chess/sound/sounds'

export type OwareSound = 'move' | 'capture' | 'gameStart' | 'gameEnd' | 'lowTime' | 'illegal'

export const feedback = (name: OwareSound) => play(name)
export const preloadSounds = preloadChessSounds

/** The seeds lifted out of a pit: a tap, and a short buzz on phones that have one. */
export const pickUpSound = () => play('move')
/** One seed dropped into a pit: a click of wood, with no buzz (a long move drops many). */
export const dropSound = () => playSound('move')
/** Seeds won, gathered into a store. */
export const collectSound = () => {
  playSound('capture')
  buzz('capture')
}
