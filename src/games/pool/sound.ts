// The sounds of a pool table, made with the Web Audio API (no audio files). Pool balls are hard
// resin: when two meet there is a short, dry "clack" and nothing rings on afterwards. So every
// sound here is over within a few hundredths of a second; a longer tail is what makes a knock
// sound like metal or glass.

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

function hiss(ctx: AudioContext): AudioBuffer {
  if (!noise) {
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.25), ctx.sampleRate)
    const data = noise.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }
  return noise
}

/** A burst of filtered noise: the "click" part of a knock. */
function burst(ctx: AudioContext, at: number, type: BiquadFilterType, frequency: number, q: number, volume: number, seconds: number) {
  const source = ctx.createBufferSource()
  source.buffer = hiss(ctx)
  const filter = ctx.createBiquadFilter()
  filter.type = type
  filter.frequency.value = frequency
  filter.Q.value = q
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(volume, at)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds)
  source.connect(filter).connect(gain).connect(ctx.destination)
  source.start(at, Math.random() * 0.1)
  source.stop(at + seconds + 0.01)
}

/** A short tone that drops in pitch as it dies: the "body" of a knock. */
function tone(ctx: AudioContext, at: number, from: number, to: number, volume: number, seconds: number, type: OscillatorType = 'sine') {
  const oscillator = ctx.createOscillator()
  oscillator.type = type
  oscillator.frequency.setValueAtTime(from, at)
  oscillator.frequency.exponentialRampToValueAtTime(to, at + seconds)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(volume, at)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds)
  oscillator.connect(gain).connect(ctx.destination)
  oscillator.start(at)
  oscillator.stop(at + seconds + 0.01)
}

function play(make: (ctx: AudioContext, at: number) => void) {
  const ctx = audio()
  if (!ctx) return
  try {
    make(ctx, ctx.currentTime + 0.004)
  } catch {
    // A sound that cannot be played is simply not heard.
  }
}

/** Ball on ball. `hard` is 0 (a kiss) to 1 (the break). */
export function clack(hard: number) {
  play((ctx, at) => {
    const v = 0.12 + hard * 0.6
    // The crack itself: a very short, bright click. Brighter the harder the hit.
    burst(ctx, at, 'bandpass', 2600 + hard * 1400, 0.9, v * 1.3, 0.012)
    // The pitch of two resin balls meeting: gone in under three hundredths of a second.
    tone(ctx, at, 1750, 1500, v * 0.5, 0.022, 'triangle')
    tone(ctx, at, 880, 700, v * 0.35, 0.028)
    // A little weight under a hard hit.
    if (hard > 0.3) tone(ctx, at, 240, 150, v * 0.3 * hard, 0.04)
  })
}

/** A ball into a cushion: rubber under cloth, a soft thump. */
export function cushion(hard: number) {
  play((ctx, at) => {
    const v = 0.1 + hard * 0.4
    tone(ctx, at, 150, 80, v, 0.07)
    burst(ctx, at, 'lowpass', 500, 0.5, v * 0.5, 0.04)
  })
}

/** A ball dropping into a pocket: the fall, then a knock or two as it settles. */
export function drop() {
  play((ctx, at) => {
    tone(ctx, at, 190, 70, 0.5, 0.13)
    burst(ctx, at, 'lowpass', 700, 0.6, 0.3, 0.07)
    for (const [delay, volume] of [[0.11, 0.2], [0.19, 0.11]] as const) {
      burst(ctx, at + delay, 'bandpass', 1500, 1, volume, 0.012)
      tone(ctx, at + delay, 520, 400, volume * 0.6, 0.03)
    }
  })
}

/** The cue tip on the cue ball: leather on resin, duller than ball on ball. */
export function strike(hard: number) {
  play((ctx, at) => {
    const v = 0.15 + hard * 0.5
    burst(ctx, at, 'bandpass', 1300, 0.8, v, 0.014)
    tone(ctx, at, 520, 330, v * 0.6, 0.035)
  })
}
