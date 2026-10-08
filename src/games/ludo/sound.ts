// Ludo's sounds. The throw is a recording of real dice with the ring of a glass board under
// it, and pieces are real wood (small CC0 files, see ASSETS.md). Every sound is also
// synthesised here with the Web Audio API: that version plays until the recordings have
// arrived, in data-saver mode, and on a phone that cannot play the file format.
import { anyOf, type Hit, playRecorded, preloadRecorded } from '@/core/audio/recorded'
import { useSettingsStore } from '@/core/settings/settingsStore'

export type LudoSound = 'roll' | 'step' | 'capture' | 'home' | 'win' | 'lose' | 'turn'

let context: AudioContext | null = null

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    context ??= new AudioContext()
    // Browsers keep audio suspended until the player has touched the page.
    if (context.state === 'suspended') void context.resume()
    return context
  } catch {
    return null
  }
}

function tone(ctx: AudioContext, at: number, frequency: number, seconds: number, volume = 0.15, type: OscillatorType = 'triangle', slideTo?: number) {
  const osc = ctx.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(frequency, at)
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, at + seconds)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(volume, at)
  gain.gain.exponentialRampToValueAtTime(0.001, at + seconds)
  osc.connect(gain).connect(ctx.destination)
  osc.start(at)
  osc.stop(at + seconds + 0.02)
}

let noise: AudioBuffer | null = null
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noise) return noise
  noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.25), ctx.sampleRate)
  const data = noise.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return noise
}

/**
 * Dice thrown onto a glass board. Each time a die touches down there is a hard, bright click
 * (a burst of noise through a narrow high filter) and the pane answers with a short ring (two
 * high partials that are not in tune with each other, as glass is not). The bounces start
 * strong and far apart and end as a quick, quiet chatter as the dice settle. Synthesised, so
 * no two throws sound quite the same.
 */
function diceOnGlass(ctx: AudioContext, at: number) {
  let t = 0
  let gap = 0.085
  let level = 1
  for (let bounce = 0; bounce < 11; bounce++) {
    const when = at + t
    const click = ctx.createBufferSource()
    click.buffer = noiseBuffer(ctx)
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 3600 + Math.random() * 2600
    filter.Q.value = 7
    const clickGain = ctx.createGain()
    clickGain.gain.setValueAtTime(0.5 * level, when)
    clickGain.gain.exponentialRampToValueAtTime(0.001, when + 0.035)
    click.connect(filter).connect(clickGain).connect(ctx.destination)
    click.start(when, Math.random() * 0.1)
    click.stop(when + 0.05)

    const pitch = 2300 + Math.random() * 1500
    tone(ctx, when, pitch, 0.11, 0.07 * level, 'sine')
    tone(ctx, when, pitch * 2.76, 0.06, 0.03 * level, 'sine')

    // Two dice do not land together: now and then a second, lighter touch follows at once.
    if (bounce % 3 === 1) tone(ctx, when + 0.018, pitch * 1.31, 0.07, 0.05 * level, 'sine')

    t += gap * (0.75 + Math.random() * 0.5)
    gap *= 0.78
    level *= 0.8
  }
}

const SOUNDS: Record<LudoSound, (ctx: AudioContext, at: number) => void> = {
  roll: diceOnGlass,
  step: (ctx, at) => tone(ctx, at, 660, 0.05, 0.1),
  capture: (ctx, at) => tone(ctx, at, 440, 0.28, 0.18, 'sawtooth', 110),
  home: (ctx, at) => [523, 659, 784].forEach((f, i) => tone(ctx, at + i * 0.08, f, 0.16)),
  win: (ctx, at) => [523, 659, 784, 1047].forEach((f, i) => tone(ctx, at + i * 0.12, f, 0.3, 0.17)),
  lose: (ctx, at) => [392, 330, 262].forEach((f, i) => tone(ctx, at + i * 0.16, f, 0.32, 0.14)),
  turn: (ctx, at) => tone(ctx, at, 880, 0.09, 0.1),
}

const glass = () => anyOf('glass-light-1', 'glass-light-2', 'glass-light-3')
const RECORDED: Partial<Record<LudoSound, () => Hit[]>> = {
  // The dice leave the hand, then each touches the glass, a moment apart.
  roll: () => [
    { file: anyOf('dice-throw-1', 'dice-throw-2', 'dice-throw-3') },
    { file: glass(), at: 0.12, volume: 0.45 },
    { file: glass(), at: 0.27, volume: 0.3, rate: 1.15 },
  ],
  step: () => [{ file: anyOf('wood-light-1', 'wood-light-2', 'wood-light-3'), volume: 0.45, rate: 1.3 }],
  capture: () => [{ file: anyOf('wood-heavy-1', 'wood-heavy-2') }],
  home: () => [{ file: 'chime-1', volume: 0.7 }],
  win: () => [{ file: 'chime-2', volume: 0.85 }],
}

/** Fetches the recordings when a table opens, so the first throw already sounds right. */
export function preloadLudoSounds() {
  const { soundOn, dataSaver } = useSettingsStore.getState()
  if (soundOn && !dataSaver) {
    preloadRecorded(['dice-throw-1', 'dice-throw-2', 'dice-throw-3', 'glass-light-1', 'glass-light-2', 'glass-light-3', 'wood-light-1', 'wood-light-2', 'wood-light-3', 'wood-heavy-1', 'wood-heavy-2', 'chime-1', 'chime-2'])
  }
}

const BUZZ: Partial<Record<LudoSound, number | number[]>> = { capture: [30, 40, 60], home: 25, win: [40, 60, 40, 60, 120], turn: 15 }

/** Plays a sound and, where it suits, a short vibration, respecting the player's settings. */
export function ludoFeedback(name: LudoSound) {
  const { soundOn, hapticsOn, dataSaver } = useSettingsStore.getState()
  if (soundOn) {
    const hits = dataSaver ? undefined : RECORDED[name]?.()
    if (!hits || !playRecorded(hits)) {
      const ctx = audio()
      if (ctx) SOUNDS[name](ctx, ctx.currentTime + 0.01)
    }
  }
  const buzz = BUZZ[name]
  if (hapticsOn && buzz && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(buzz)
    } catch {
      // Not every browser allows it; the game is the same without.
    }
  }
}
