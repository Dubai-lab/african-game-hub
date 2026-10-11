// Check Up is cards laid on a table: a card going down is heard the way a piece going down is,
// with the hub's own recordings (see ASSETS.md) and the synthesised version underneath them.
import { feedback as play, preloadChessSounds } from '@/games/chess/sound/sounds'

export type CheckUpSound = 'card' | 'market' | 'gameStart' | 'gameEnd' | 'lowTime' | 'refused'

const AS = { card: 'move', market: 'capture', gameStart: 'gameStart', gameEnd: 'gameEnd', lowTime: 'lowTime', refused: 'illegal' } as const

export const feedback = (name: CheckUpSound) => play(AS[name])
export const preloadSounds = preloadChessSounds
