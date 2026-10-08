import { useEffect } from 'react'
import * as z from 'zod/mini'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useAuth } from '@/core/auth/AuthContext'
import { supabase } from '@/core/lib/supabase'

// Cosmetic preferences. Stored on the device so they apply instantly (and offline), and copied
// to the player's account so they follow them to another phone.
const preferencesSchema = z.object({
  soundOn: z.boolean(),
  hapticsOn: z.boolean(),
  /** Fewer downloads and less motion: no 3D on the landing page, no piece animations. */
  dataSaver: z.boolean(),
  chessBoardTheme: z.enum(['indigo', 'green', 'wood', 'grey']),
  chessPieceSet: z.enum(['hub', 'chessnut', 'rhosgfx']),
  /** Lets a player queue their next move while the opponent is still thinking. */
  chessPremoves: z.boolean(),
  /** Ludo: how many dice the player likes to play with (the games they search for, and practice). */
  ludoDice: z.union([z.literal(1), z.literal(2)]),
  /** Ludo: the board leaning away in 3D, or seen from straight above. */
  ludoBoard3d: z.boolean(),
  /** Ludo: which of the boards to play on. */
  ludoBoard: z.enum(['classic', 'wood', 'night']),
  /** Ludo, two players: hold one house each, or both sides (two houses each). */
  ludoSides: z.union([z.literal(1), z.literal(2)]),
  /** Ludo: a piece that captures goes straight home. */
  ludoLay: z.boolean(),
  /** Pool: the colour of the cloth. */
  poolCloth: z.enum(['green', 'blue', 'red']),
  /** Pool: the whole aiming line, or only as far as the first ball. */
  poolGuide: z.enum(['full', 'short']),
  /** Pool: which cue the player plays with (looks only). */
  poolCue: z.enum(['maple', 'ebony', 'ocean', 'kente']),
})

export type Preferences = z.infer<typeof preferencesSchema>
export type BoardThemeId = Preferences['chessBoardTheme']
export type PieceSetId = Preferences['chessPieceSet']

const DEFAULTS: Preferences = {
  soundOn: true,
  hapticsOn: true,
  dataSaver: false,
  chessBoardTheme: 'indigo',
  chessPieceSet: 'hub',
  chessPremoves: true,
  ludoDice: 2,
  ludoBoard3d: true,
  ludoBoard: 'classic',
  ludoSides: 2,
  ludoLay: true,
  poolCloth: 'green',
  poolGuide: 'full',
  poolCue: 'maple',
}

type SettingsState = Preferences & {
  /**
   * True from the moment the player changes something until the account copy has it. While it
   * is true this device's choices win, so a quick reload can never undo a change just made.
   */
  unsynced: boolean
  /** A change made by the player. */
  set: (patch: Partial<Preferences>) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist((set) => ({ ...DEFAULTS, unsynced: false, set: (patch) => set({ ...patch, unsynced: true }) }), {
    name: 'agh.settings',
    version: 1,
  }),
)

function currentPreferences(): Preferences {
  const { soundOn, hapticsOn, dataSaver, chessBoardTheme, chessPieceSet, chessPremoves, ludoDice, ludoBoard3d, ludoBoard, ludoSides, ludoLay, poolCloth, poolGuide, poolCue } =
    useSettingsStore.getState()
  return { soundOn, hapticsOn, dataSaver, chessBoardTheme, chessPieceSet, chessPremoves, ludoDice, ludoBoard3d, ludoBoard, ludoSides, ludoLay, poolCloth, poolGuide, poolCue }
}

const SAVE_DELAY_MS = 800

/** Mounted once for a signed-in player: loads their saved preferences, then saves changes. */
export function useSettingsSync() {
  const { user } = useAuth()
  const userId = user?.id

  useEffect(() => {
    if (!userId) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined

    async function save() {
      clearTimeout(timer)
      if (!useSettingsStore.getState().unsynced) return
      const sent = currentPreferences()
      try {
        const { error } = await supabase.from('profile_private').update({ preferences: sent }).eq('user_id', userId!)
        // Only settled if nothing changed again while the request was on its way.
        if (!error && JSON.stringify(sent) === JSON.stringify(currentPreferences())) {
          useSettingsStore.setState({ unsynced: false })
        }
      } catch {
        // Stays unsynced; it is sent again on the next change, or the next time the app opens.
      }
    }

    async function load() {
      // Something changed here that the account does not have yet: send it, do not overwrite it.
      if (useSettingsStore.getState().unsynced) return save()
      try {
        const { data, error } = await supabase.from('profile_private').select('preferences').eq('user_id', userId!).maybeSingle()
        if (!active || error || useSettingsStore.getState().unsynced) return
        // Anything unknown or malformed in the stored value is ignored field by field.
        const saved = z.partial(preferencesSchema).safeParse(data?.preferences)
        if (saved.success && Object.keys(saved.data).length > 0) useSettingsStore.setState(saved.data)
      } catch {
        // Offline: the device's own copy is used.
      }
    }
    void load()

    const unsubscribe = useSettingsStore.subscribe((state) => {
      if (!state.unsynced) return
      clearTimeout(timer)
      timer = setTimeout(() => void save(), SAVE_DELAY_MS)
    })
    // Leaving the app: do not wait for the timer.
    const flush = () => {
      if (document.visibilityState === 'hidden') void save()
    }
    document.addEventListener('visibilitychange', flush)

    return () => {
      active = false
      clearTimeout(timer)
      unsubscribe()
      document.removeEventListener('visibilitychange', flush)
    }
  }, [userId])
}
