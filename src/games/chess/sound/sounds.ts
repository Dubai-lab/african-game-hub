// The sounds of the chess screens. Moves, captures and the end of a game are recordings of
// real wood and a short chime (small CC0 files, see ASSETS.md). Underneath them every sound is
// also synthesised here with the Web Audio API: that version plays until the recordings have
// arrived, in data-saver mode, and on a phone that cannot play the file format.
import { anyOf, type Hit, playRecorded, preloadRecorded } from '@/core/audio/recorded'
import { useSettingsStore } from '@/core/settings/settingsStore'

export type SoundName = 'move' | 'capture' | 'castle' | 'check' | 'promote' | 'gameStart' | 'gameEnd' | 'lowTime' | 'illegal'

let context: AudioContext | null = null
let noise: AudioBuffer | null = null

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

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noise) return noise
  noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.2), ctx.sampleRate)
  const data = noise.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return noise
}

/** A piece set down on wood: a short filtered click over a low thump. */
function knock(ctx: AudioContext, at: number, weight = 1) {
  const click = ctx.createBufferSource()
  click.buffer = noiseBuffer(ctx)
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = 1500 - 500 * (weight - 1)
  filter.Q.value = 1.1
  const clickGain = ctx.createGain()
  clickGain.gain.setValueAtTime(0.5 * weight, at)
  clickGain.gain.exponentialRampToValueAtTime(0.001, at + 0.05)
  click.connect(filter).connect(clickGain).connect(ctx.destination)
  click.start(at)
  click.stop(at + 0.07)

  const thump = ctx.createOscillator()
  thump.type = 'sine'
  thump.frequency.setValueAtTime(190 / weight, at)
  thump.frequency.exponentialRampToValueAtTime(70, at + 0.09)
  const thumpGain = ctx.createGain()
  thumpGain.gain.setValueAtTime(0.42 * weight, at)
  thumpGain.gain.exponentialRampToValueAtTime(0.001, at + 0.12)
  thump.connect(thumpGain).connect(ctx.destination)
  thump.start(at)
  thump.stop(at + 0.14)
}

function tone(ctx: AudioContext, at: number, frequency: number, seconds: number, volume = 0.16, type: OscillatorType = 'triangle') {
  const osc = ctx.createOscillator()
  osc.type = type
  osc.frequency.value = frequency
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.001, at + seconds)
  osc.connect(gain).connect(ctx.destination)
  osc.start(at)
  osc.stop(at + seconds + 0.02)
}

const recipes: Record<SoundName, (ctx: AudioContext, at: number) => void> = {
  move: (ctx, at) => knock(ctx, at),
  capture: (ctx, at) => {
    knock(ctx, at, 1.45)
    knock(ctx, at + 0.035, 0.8)
  },
  castle: (ctx, at) => {
    knock(ctx, at)
    knock(ctx, at + 0.11)
  },
  check: (ctx, at) => {
    knock(ctx, at)
    tone(ctx, at + 0.02, 880, 0.22, 0.13)
  },
  promote: (ctx, at) => {
    knock(ctx, at)
    ;[523, 659, 784].forEach((f, i) => tone(ctx, at + 0.05 + i * 0.07, f, 0.2))
  },
  gameStart: (ctx, at) => {
    tone(ctx, at, 392, 0.2)
    tone(ctx, at + 0.13, 587, 0.34)
  },
  gameEnd: (ctx, at) => {
    tone(ctx, at, 587, 0.2)
    tone(ctx, at + 0.14, 494, 0.2)
    tone(ctx, at + 0.28, 392, 0.5)
  },
  lowTime: (ctx, at) => {
    ;[0, 0.14, 0.28].forEach((offset) => tone(ctx, at + offset, 1175, 0.08, 0.12, 'square'))
  },
  illegal: (ctx, at) => tone(ctx, at, 150, 0.14, 0.12, 'sawtooth'),
}

const light = () => anyOf('wood-light-1', 'wood-light-2', 'wood-light-3')
/** The recorded version of each sound, where there is one: a piece set down on wood. */
const recorded: Partial<Record<SoundName, () => Hit[]>> = {
  move: () => [{ file: light(), volume: 0.9 }],
  // A capture is two pieces: the taker comes down hard, the taken one is knocked aside.
  capture: () => [
    { file: anyOf('wood-heavy-1', 'wood-heavy-2') },
    { file: light(), at: 0.07, volume: 0.55, rate: 1.25 },
  ],
  castle: () => [
    { file: light(), volume: 0.9 },
    { file: light(), at: 0.13, volume: 0.9, rate: 0.92 },
  ],
  check: () => [{ file: anyOf('wood-medium-1', 'wood-medium-2') }, { file: 'chime-1', at: 0.04, volume: 0.35, rate: 1.5 }],
  promote: () => [{ file: light() }, { file: 'chime-1', at: 0.06, volume: 0.6 }],
  gameStart: () => [{ file: 'chime-3', volume: 0.6 }],
  gameEnd: () => [{ file: 'chime-2', volume: 0.8 }],
}

/** Fetches the recordings before the first move, so the first move already sounds right. */
export function preloadChessSounds() {
  const { soundOn, dataSaver } = useSettingsStore.getState()
  if (soundOn && !dataSaver) preloadRecorded(['wood-light-1', 'wood-light-2', 'wood-light-3', 'wood-heavy-1', 'wood-heavy-2', 'wood-medium-1', 'wood-medium-2', 'chime-1', 'chime-2', 'chime-3'])
}

export function playSound(name: SoundName) {
  const { soundOn, dataSaver } = useSettingsStore.getState()
  if (!soundOn) return
  const hits = dataSaver ? undefined : recorded[name]?.()
  if (hits && playRecorded(hits)) return
  const ctx = audio()
  if (!ctx) return
  try {
    recipes[name](ctx, ctx.currentTime + 0.005)
  } catch {
    // A sound that fails must never interrupt a game.
  }
}

const patterns: Partial<Record<SoundName, number | number[]>> = {
  move: 8,
  castle: 8,
  capture: 16,
  promote: [10, 40, 10],
  check: [14, 40, 14],
  gameEnd: [30, 60, 30],
  lowTime: [10, 50, 10, 50, 10],
  illegal: 25,
}

/** A short buzz on phones that support it (Android; iPhones ignore this). */
export function buzz(name: SoundName) {
  if (!useSettingsStore.getState().hapticsOn) return
  const pattern = patterns[name]
  if (pattern === undefined || typeof navigator === 'undefined' || !('vibrate' in navigator)) return
  try {
    navigator.vibrate(pattern)
  } catch {
    // Not allowed here; ignore.
  }
}

export function feedback(name: SoundName) {
  playSound(name)
  buzz(name)
}
