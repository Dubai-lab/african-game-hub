// One Africa Life: the town's sounds (public/oal/sounds, scripts/oal/makeCarSounds.py from the
// owner's recordings), heard from where they are (the camera is the ears): the nearest vehicles'
// engines (idling, or driving and higher the faster they go; a kekeh's higher and harder), the
// police's sirens, horns, tyres screeching, a crash, the doors and the engine of the player's own
// car, the town's traffic far off. Off when the player has turned sound off (the hub's setting).
import { useSettingsStore } from '@/core/settings/settingsStore'

const FILES = {
  idle: '/oal/sounds/engine-idle.wav',
  drive: '/oal/sounds/engine-drive.wav',
  start: '/oal/sounds/engine-start.mp3',
  doorOpen: '/oal/sounds/door-open.mp3',
  doorClose: '/oal/sounds/door-close.mp3',
  horn: '/oal/sounds/horn.mp3',
  screech: '/oal/sounds/screech.mp3',
  crash: '/oal/sounds/crash.mp3',
  siren: '/oal/sounds/siren.wav',
  traffic: '/oal/sounds/traffic.wav',
} as const
type Name = keyof typeof FILES

let ctx: AudioContext | null = null
let master: GainNode | null = null
const buffers = new Map<Name, AudioBuffer>()
let loading = false

const on = () => useSettingsStore.getState().soundOn

/** The sounds' context, made on the player's first touch (browsers wait for one), and its files. */
export function wakeSound() {
  if (typeof window === 'undefined') return
  if (!ctx) {
    try {
      ctx = new AudioContext()
    } catch {
      return
    }
    master = ctx.createGain()
    master.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
  if (loading) return
  loading = true
  for (const [name, url] of Object.entries(FILES) as [Name, string][])
    fetch(url)
      .then((r) => r.arrayBuffer())
      .then((b) => ctx!.decodeAudioData(b))
      .then((buf) => buffers.set(name, buf))
      .catch(() => undefined)
}

if (typeof window !== 'undefined') {
  const wake = () => wakeSound()
  window.addEventListener('pointerdown', wake, { passive: true })
  window.addEventListener('keydown', wake)
}

/** The ears: where the camera is and which way it looks (three's frame). */
export function hearFrom(x: number, y: number, z: number, fx: number, fy: number, fz: number) {
  if (!ctx || !master) return
  master.gain.value = on() ? 1 : 0
  const l = ctx.listener
  if (l.positionX) {
    l.positionX.value = x
    l.positionY.value = y
    l.positionZ.value = z
    l.forwardX.value = fx
    l.forwardY.value = fy
    l.forwardZ.value = fz
    l.upX.value = 0
    l.upY.value = 1
    l.upZ.value = 0
  } else {
    l.setPosition(x, y, z)
    l.setOrientation(fx, fy, fz, 0, 1, 0)
  }
}

function panner(at: [number, number, number], ref = 5, max = 90) {
  const p = ctx!.createPanner()
  p.panningModel = 'HRTF'
  p.distanceModel = 'inverse'
  p.refDistance = ref
  p.maxDistance = max
  p.rolloffFactor = 1.3
  place(p, at)
  return p
}

function place(p: PannerNode, [x, y, z]: [number, number, number]) {
  if (p.positionX) {
    p.positionX.value = x
    p.positionY.value = y
    p.positionZ.value = z
  } else p.setPosition(x, y, z)
}

/** A sound once, from a point (or, without one, in the player's own ears). */
export function playOnce(name: Name, at?: [number, number, number], volume = 1, rate = 1) {
  if (!ctx || !master || !on()) return
  const buf = buffers.get(name)
  if (!buf) return
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.playbackRate.value = rate
  const g = ctx.createGain()
  g.gain.value = volume
  src.connect(g)
  if (at) g.connect(panner(at)).connect(master)
  else g.connect(master)
  src.start()
}

/** An engine (a vehicle's, heard from where it is): its idle and its driving, blended by speed. */
export type Engine = {
  set: (at: [number, number, number], speed: number, throttle: number, kind: 'car' | 'kekeh', siren: boolean) => void
  stop: () => void
}

export function engine(near = false): Engine | null {
  if (!ctx || !master) return null
  const idle = buffers.get('idle')
  const drive = buffers.get('drive')
  if (!idle || !drive) return null
  const c = ctx
  const mk = (buf: AudioBuffer) => {
    const s = c.createBufferSource()
    s.buffer = buf
    s.loop = true
    const g = c.createGain()
    g.gain.value = 0
    s.connect(g)
    s.start(0, Math.random() * buf.duration)
    return { s, g }
  }
  const a = mk(idle)
  const b = mk(drive)
  // A kekeh's engine: a two-stroke's, higher and harder (filtered to a rasp).
  const shape = c.createBiquadFilter()
  shape.type = 'peaking'
  shape.frequency.value = 1400
  shape.gain.value = 0
  const p = near ? null : panner([0, 0, 0], 4, 70)
  a.g.connect(shape)
  b.g.connect(shape)
  if (p) shape.connect(p).connect(master!)
  else shape.connect(master!)
  let sirenSrc: { s: AudioBufferSourceNode; g: GainNode } | null = null
  return {
    set(at, speed, throttle, kind, siren) {
      if (p) place(p, at)
      const v = Math.abs(speed)
      const going = Math.min(1, v / 4 + Math.max(0, throttle) * 0.4)
      const t = c.currentTime
      const k = kind === 'kekeh'
      a.g.gain.setTargetAtTime((1 - going) * (near ? 0.55 : 0.8), t, 0.15)
      b.g.gain.setTargetAtTime(going * (near ? 0.7 : 0.9), t, 0.15)
      a.s.playbackRate.setTargetAtTime((k ? 1.9 : 1) + Math.max(0, throttle) * 0.25, t, 0.1)
      b.s.playbackRate.setTargetAtTime((k ? 1.45 : 0.8) + Math.min(v, 25) / 25 * (k ? 0.5 : 0.6) + Math.max(0, throttle) * 0.12, t, 0.1)
      shape.gain.value = k ? 9 : 0
      if (siren && !sirenSrc) {
        const buf = buffers.get('siren')
        if (buf) {
          sirenSrc = mk(buf)
          sirenSrc.g.gain.value = 0.9
          if (p) sirenSrc.g.connect(p)
          else sirenSrc.g.connect(master!)
        }
      } else if (!siren && sirenSrc) {
        sirenSrc.s.stop()
        sirenSrc = null
      }
    },
    stop() {
      try {
        a.s.stop()
        b.s.stop()
        sirenSrc?.s.stop()
      } catch {
        // (Already stopped.)
      }
      shape.disconnect()
    },
  }
}

/** The town's traffic far off: always there, quieter indoors and in a car. */
let hum: { g: GainNode } | null = null
export function townHum(level: number) {
  if (!ctx || !master) return
  if (!hum) {
    const buf = buffers.get('traffic')
    if (!buf) return
    const s = ctx.createBufferSource()
    s.buffer = buf
    s.loop = true
    const g = ctx.createGain()
    g.gain.value = 0
    s.connect(g).connect(master)
    s.start()
    hum = { g }
  }
  hum.g.gain.setTargetAtTime(level, ctx.currentTime, 0.6)
}
