// The court's music: an original amapiano groove made in the browser (no files, nothing to
// license or download). Log drum, shakers, a soft kick, snaps and warm keys, at 112 beats a
// minute, four bars round and round, kept under the sounds of the game. Silent when the player
// has turned sounds or the music off.
//
// The notes are scheduled a little ahead on the audio clock, so the beat holds steady however
// busy the drawing is.
import { useSettingsStore } from '@/core/settings/settingsStore'

const BPM = 112
const STEP = 60 / BPM / 4
/** The four bars' chords, as notes of the keys (MIDI numbers): Am9, Fmaj7, Cmaj7, Em7. */
const CHORDS = [
  [57, 60, 64, 67, 71],
  [53, 57, 60, 64],
  [48, 52, 55, 59],
  [52, 55, 59, 62],
]
/** The log drum: (step in the bar, note), the bassline that makes amapiano. */
const LOG = [
  [0, 33],
  [3, 33],
  [6, 45],
  [10, 40],
  [11, 43],
  [14, 45],
] as const
const ROOTS = [0, -4, -9, -5]

const hz = (note: number) => 440 * 2 ** ((note - 69) / 12)

let context: AudioContext | null = null
let master: GainNode | null = null
let noise: AudioBuffer | null = null
let timer: number | null = null
let nextAt = 0
let step = 0

function noiseBuffer(ctx: AudioContext) {
  if (noise) return noise
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
  const data = noise.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return noise
}

function blip(ctx: AudioContext, at: number, attack: number, hold: number, volume: number) {
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(volume, at + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + hold)
  gain.connect(master!)
  return gain
}

function kick(ctx: AudioContext, at: number) {
  const o = ctx.createOscillator()
  o.frequency.setValueAtTime(120, at)
  o.frequency.exponentialRampToValueAtTime(45, at + 0.12)
  o.connect(blip(ctx, at, 0.004, 0.22, 0.55))
  o.start(at)
  o.stop(at + 0.3)
}

/** The log drum: a round, wooden bass note that slides down a touch. */
function logDrum(ctx: AudioContext, at: number, note: number) {
  const o = ctx.createOscillator()
  o.type = 'sine'
  o.frequency.setValueAtTime(hz(note) * 1.06, at)
  o.frequency.exponentialRampToValueAtTime(hz(note), at + 0.05)
  const knock = ctx.createOscillator()
  knock.type = 'triangle'
  knock.frequency.value = hz(note) * 2
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(900, at)
  filter.frequency.exponentialRampToValueAtTime(220, at + 0.25)
  o.connect(filter)
  knock.connect(blip(ctx, at, 0.002, 0.06, 0.12))
  filter.connect(blip(ctx, at, 0.006, 0.34, 0.5))
  o.start(at)
  o.stop(at + 0.45)
  knock.start(at)
  knock.stop(at + 0.1)
}

function shaker(ctx: AudioContext, at: number, loud: boolean) {
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer(ctx)
  const filter = ctx.createBiquadFilter()
  filter.type = 'highpass'
  filter.frequency.value = 6500
  src.connect(filter)
  filter.connect(blip(ctx, at, 0.004, 0.045, loud ? 0.09 : 0.045))
  src.start(at, Math.random() * 0.5)
  src.stop(at + 0.08)
}

function snap(ctx: AudioContext, at: number) {
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer(ctx)
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = 1800
  filter.Q.value = 1.4
  src.connect(filter)
  filter.connect(blip(ctx, at, 0.002, 0.11, 0.22))
  src.start(at, Math.random() * 0.5)
  src.stop(at + 0.15)
}

/** Warm keys: a soft electric-piano chord, short. */
function keys(ctx: AudioContext, at: number, chord: readonly number[], length: number) {
  for (const note of chord) {
    for (const [type, mult, volume] of [
      ['sine', 1, 0.05],
      ['triangle', 2, 0.012],
    ] as const) {
      const o = ctx.createOscillator()
      o.type = type
      o.frequency.value = hz(note) * mult
      o.detune.value = (Math.random() - 0.5) * 8
      o.connect(blip(ctx, at, 0.012, length, volume))
      o.start(at)
      o.stop(at + length + 0.1)
    }
  }
}

function play(ctx: AudioContext, at: number, n: number) {
  const bar = Math.floor(n / 16) % 4
  const s = n % 16
  if (s % 4 === 0) kick(ctx, at)
  if (s === 4 || s === 12) snap(ctx, at)
  shaker(ctx, at, s % 2 === 1)
  for (const [where, note] of LOG) if (where === s) logDrum(ctx, at, note + ROOTS[bar]!)
  if (s === 2 || s === 7 || s === 10) keys(ctx, at, CHORDS[bar]!, s === 10 ? 0.5 : 0.22)
}

function tick() {
  if (!context) return
  while (nextAt < context.currentTime + 0.15) {
    play(context, nextAt, step)
    nextAt += STEP
    step++
  }
}

/** Starts the music (on a tap, so the phone lets it play), if sounds and music are on. */
export function startMusic() {
  const { soundOn, basketballMusic } = useSettingsStore.getState()
  if (!soundOn || !basketballMusic || timer !== null) return
  try {
    context ??= new AudioContext()
    if (context.state === 'suspended') void context.resume()
    master = context.createGain()
    master.gain.value = 0.32
    master.connect(context.destination)
    nextAt = context.currentTime + 0.1
    step = 0
    timer = window.setInterval(tick, 40)
  } catch {
    // No music; the game plays on.
  }
}

/** Stops it, fading out over a moment. */
export function stopMusic() {
  if (timer !== null) window.clearInterval(timer)
  timer = null
  if (context && master) {
    const gain = master
    gain.gain.setTargetAtTime(0.0001, context.currentTime, 0.15)
    window.setTimeout(() => gain.disconnect(), 800)
  }
  master = null
}

/** Quieter (under the game's end) or back to normal. */
export function musicVolume(level: number) {
  if (context && master) master.gain.setTargetAtTime(0.32 * level, context.currentTime, 0.3)
}
