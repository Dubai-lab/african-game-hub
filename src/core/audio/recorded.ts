// Recorded sounds: real wood, glass and dice, from small files in public/sounds/ (all CC0, see
// ASSETS.md). Shared by every game. Each file is fetched the first time it is wanted and kept;
// until it has arrived, or on a phone that cannot play the format, the caller falls back to
// its own synthesised sound, so nothing is ever silent and nothing ever waits.

let context: AudioContext | null = null
const buffers = new Map<string, AudioBuffer | 'loading' | 'failed'>()

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

function load(ctx: AudioContext, file: string) {
  if (buffers.has(file)) return
  buffers.set(file, 'loading')
  fetch(`/sounds/${file}.ogg`)
    .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error('missing'))))
    .then((data) => ctx.decodeAudioData(data))
    .then((buffer) => buffers.set(file, buffer))
    // No connection, or a browser without this format: the synthesised sound stays in use.
    .catch(() => buffers.set(file, 'failed'))
}

/** Fetches sounds ahead of time, so the first move of a game already has its real sound. */
export function preloadRecorded(files: readonly string[]) {
  const ctx = audio()
  if (ctx) files.forEach((file) => load(ctx, file))
}

export type Hit = { file: string; at?: number; volume?: number; rate?: number }

/**
 * Plays recorded sounds together (each may start a little later, quieter, or at another pitch).
 * Returns false, having played nothing, unless every one of them is ready.
 */
export function playRecorded(hits: readonly Hit[]): boolean {
  const ctx = audio()
  if (!ctx) return false
  hits.forEach((hit) => load(ctx, hit.file))
  const ready = hits.map((hit) => buffers.get(hit.file))
  if (!ready.every((buffer): buffer is AudioBuffer => buffer instanceof AudioBuffer)) return false
  try {
    hits.forEach((hit, index) => {
      const source = ctx.createBufferSource()
      source.buffer = ready[index] as AudioBuffer
      source.playbackRate.value = hit.rate ?? 1
      const gain = ctx.createGain()
      gain.gain.value = hit.volume ?? 1
      source.connect(gain).connect(ctx.destination)
      source.start(ctx.currentTime + 0.005 + (hit.at ?? 0))
    })
    return true
  } catch {
    return false
  }
}

/** One of several takes of the same sound, so repeated moves do not sound stamped out. */
export const anyOf = (...files: string[]): string => files[Math.floor(Math.random() * files.length)]!
