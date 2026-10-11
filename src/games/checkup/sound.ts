// What Check Up sounds like: real cards on a real table. The recordings are small files in
// public/sounds/ (Kenney's Casino Audio, CC0: see ASSETS.md), fetched the first time they are
// wanted and kept on the phone. Until one has arrived, on a phone that cannot play the format,
// or with data saver on, the hub's synthesised sound is heard instead, so nothing is ever
// silent and nothing ever waits.
import { anyOf, type Hit, playRecorded, preloadRecorded } from '@/core/audio/recorded'
import { useSettingsStore } from '@/core/settings/settingsStore'
import { buzz, playSound, type SoundName } from '@/games/chess/sound/sounds'

export type CheckUpSound = 'card' | 'market' | 'shuffle' | 'gameStart' | 'gameEnd' | 'lowTime' | 'refused'

const place = () => anyOf('card-place-1', 'card-place-2', 'card-place-3', 'card-place-4')
const slide = () => anyOf('card-slide-1', 'card-slide-2', 'card-slide-3', 'card-slide-4')

/** The recording for each sound; those not listed have only the synthesised one. */
const RECORDED: Partial<Record<CheckUpSound, () => Hit[]>> = {
  // A card laid on the pile.
  card: () => [{ file: place(), volume: 0.9 }],
  // A card drawn off the market.
  market: () => [{ file: slide(), volume: 0.8 }],
  // The pack being shuffled, as a game starts.
  shuffle: () => [{ file: 'card-shuffle', volume: 0.7 }],
  gameStart: () => [{ file: 'card-shuffle', volume: 0.7 }],
  gameEnd: () => [{ file: 'card-fan-1', volume: 0.8 }, { file: 'chime-2', at: 0.12, volume: 0.7 }],
}
/** What is heard when the recording is not there. */
const SYNTH: Record<CheckUpSound, SoundName> = { card: 'move', market: 'capture', shuffle: 'gameStart', gameStart: 'gameStart', gameEnd: 'gameEnd', lowTime: 'lowTime', refused: 'illegal' }

/** Fetches the recordings before the first card, so the first card already sounds right. */
export function preloadSounds() {
  const { soundOn, dataSaver } = useSettingsStore.getState()
  if (soundOn && !dataSaver) preloadRecorded(['card-place-1', 'card-place-2', 'card-place-3', 'card-place-4', 'card-slide-1', 'card-slide-2', 'card-slide-3', 'card-slide-4', 'card-shuffle', 'card-fan-1', 'chime-2'])
}

/** The sound, and on phones that do it, a short buzz. `after` delays it (seconds), to land with what is seen. */
export function feedback(name: CheckUpSound, after = 0) {
  const { soundOn, dataSaver } = useSettingsStore.getState()
  const play = () => {
    const hits = soundOn && !dataSaver ? RECORDED[name]?.() : undefined
    if (!soundOn || !hits || !playRecorded(hits)) playSound(SYNTH[name])
    buzz(SYNTH[name])
  }
  if (after > 0) setTimeout(play, after * 1000)
  else play()
}
