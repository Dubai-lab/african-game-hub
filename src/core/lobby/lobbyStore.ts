import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { GameOptions } from '@/games/types'

type LobbyChoices = {
  gameId: string | null
  /** Remembered per game, so switching games does not lose the other game's setup. */
  stakeByGame: Record<string, number>
  optionsByGame: Record<string, GameOptions>
  chooseGame: (gameId: string) => void
  chooseStake: (gameId: string, stake: number) => void
  chooseOptions: (gameId: string, options: GameOptions) => void
}

// What the player last picked in the lobby, kept on this device. These are only preferences:
// the server re-checks game, stake and options when a match is actually requested.
export const useLobbyStore = create<LobbyChoices>()(
  persist(
    (set) => ({
      gameId: null,
      stakeByGame: {},
      optionsByGame: {},
      chooseGame: (gameId) => set({ gameId }),
      chooseStake: (gameId, stake) => set((s) => ({ stakeByGame: { ...s.stakeByGame, [gameId]: stake } })),
      chooseOptions: (gameId, options) => set((s) => ({ optionsByGame: { ...s.optionsByGame, [gameId]: options } })),
    }),
    { name: 'agh.lobby', version: 1 },
  ),
)
