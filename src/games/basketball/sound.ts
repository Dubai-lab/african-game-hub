// The sounds of the court, made in the browser (no files to download): the ball on the
// asphalt, the clank of the rim, the thud of the board, the swish of the net, and a horn at the
// end. Quiet when the player has turned sounds off.
import { useSettingsStore } from '@/core/settings/settingsStore'

let context: AudioContext | null = null
let noise: AudioBuffer | null = null

function audio(): AudioContext | null {
  if (!useSettingsStore.getState().soundOn) return null
  try {
    context ??= new AudioContext()
    if (context.state === 'suspended') void context.resume()
    return context
  } catch {
    return null
  }
}

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noise) return noise
  noise = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate)
  const data = noise.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return noise
}

function envelope(ctx: AudioContext, at: number, attack: number, hold: number, volume: number) {
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(volume, at + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + hold)
  gain.connect(ctx.destination)
  return gain
}

/** The ball on the asphalt: a low, round thump. */
export function bounceSound(speed: number) {
  const ctx = audio()
  if (!ctx) return
  const at = ctx.currentTime
  const volume = Math.min(0.5, 0.08 + speed * 0.05)
  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(150, at)
  osc.frequency.exponentialRampToValueAtTime(60, at + 0.12)
  osc.connect(envelope(ctx, at, 0.004, 0.14, volume))
  osc.start(at)
  osc.stop(at + 0.2)
}

/** The rim: a short ring of metal. */
export function rimSound(speed: number) {
  const ctx = audio()
  if (!ctx) return
  const at = ctx.currentTime
  const volume = Math.min(0.28, 0.06 + speed * 0.04)
  for (const [frequency, share] of [
    [520, 1],
    [1310, 0.5],
    [2210, 0.25],
  ] as const) {
    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = frequency
    osc.connect(envelope(ctx, at, 0.002, 0.35, volume * share))
    osc.start(at)
    osc.stop(at + 0.4)
  }
}

/** The backboard: a hollow thud. */
export function boardSound() {
  const ctx = audio()
  if (!ctx) return
  const at = ctx.currentTime
  const osc = ctx.createOscillator()
  osc.type = 'square'
  osc.frequency.setValueAtTime(110, at)
  osc.frequency.exponentialRampToValueAtTime(70, at + 0.1)
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 600
  osc.connect(filter)
  filter.connect(envelope(ctx, at, 0.003, 0.12, 0.22))
  osc.start(at)
  osc.stop(at + 0.16)
}

/** The net: a soft rush of air. */
export function swishSound() {
  const ctx = audio()
  if (!ctx) return
  const at = ctx.currentTime
  const source = ctx.createBufferSource()
  source.buffer = noiseBuffer(ctx)
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.setValueAtTime(2400, at)
  filter.frequency.exponentialRampToValueAtTime(900, at + 0.3)
  filter.Q.value = 0.9
  source.connect(filter)
  filter.connect(envelope(ctx, at, 0.02, 0.32, 0.3))
  source.start(at)
  source.stop(at + 0.4)
}

/** A hand slapping the ball away, or a reach that misses. */
export function slapSound() {
  const ctx = audio()
  if (!ctx) return
  const at = ctx.currentTime
  const source = ctx.createBufferSource()
  source.buffer = noiseBuffer(ctx)
  const filter = ctx.createBiquadFilter()
  filter.type = 'highpass'
  filter.frequency.value = 1500
  source.connect(filter)
  filter.connect(envelope(ctx, at, 0.002, 0.07, 0.25))
  source.start(at)
  source.stop(at + 0.1)
}

/** The end of the game: a horn. */
export function hornSound() {
  const ctx = audio()
  if (!ctx) return
  const at = ctx.currentTime
  for (const frequency of [233, 349]) {
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.value = frequency
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 1200
    osc.connect(filter)
    filter.connect(envelope(ctx, at, 0.03, 0.9, 0.09))
    osc.start(at)
    osc.stop(at + 1)
  }
}
