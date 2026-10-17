import { lazy } from 'react'
import type { GameModule } from '@/games/types'

// Street basketball on the hub. Its online matches will be run by the game server; until then
// it is listed with the other games and its Play button opens practice against the computer.
export const basketballModule: GameModule = {
  id: 'basketball',
  defaultOptions: () => ({}),
  isValidOptions: () => true,
  ratingPool: () => 'default',
  OptionsPicker: () => null,
  MatchScreen: lazy(() => import('./BasketballMatchPage')),
  practice: [{ to: '/play/basketball/practice', labelKey: 'basketball.practice.link' }],
  practiceOnly: '/play/basketball/practice',
}
