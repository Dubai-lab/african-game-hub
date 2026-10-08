import type { Color } from './chessLogic'

/**
 * A chess clock as a plain value. `since` is the moment the running side's time started
 * counting. Local games use the device clock; online games will fill this same shape from the
 * server's values, so the display code never changes and never decides anything itself.
 */
export type ClockState = {
  whiteMs: number
  blackMs: number
  incrementMs: number
  running: Color | null
  since: number | null
}

export function newClock(baseMs: number, incrementMs: number): ClockState {
  return { whiteMs: baseMs, blackMs: baseMs, incrementMs, running: null, since: null }
}

export function remainingMs(clock: ClockState, color: Color, now: number): number {
  const stored = color === 'w' ? clock.whiteMs : clock.blackMs
  if (clock.running !== color || clock.since === null) return Math.max(0, stored)
  return Math.max(0, stored - (now - clock.since))
}

/** `mover` has just moved: take their elapsed time, add the increment, start the other clock. */
export function pressClock(clock: ClockState, mover: Color, now: number): ClockState {
  const left = remainingMs(clock, mover, now)
  // The first move of a local game starts the clocks; nothing has elapsed yet and no increment is due.
  const after = clock.running === null ? left : left + clock.incrementMs
  return {
    ...clock,
    whiteMs: mover === 'w' ? after : clock.whiteMs,
    blackMs: mover === 'b' ? after : clock.blackMs,
    running: mover === 'w' ? 'b' : 'w',
    since: now,
  }
}

/** Freezes both clocks at their current values (game over). */
export function stopClock(clock: ClockState, now: number): ClockState {
  return {
    ...clock,
    whiteMs: remainingMs(clock, 'w', now),
    blackMs: remainingMs(clock, 'b', now),
    running: null,
    since: null,
  }
}

export const LOW_TIME_MS = 20_000
export const TENTHS_BELOW_MS = 10_000

/** "5:00", "0:42", and with tenths under ten seconds: "0:09.4". */
export function formatClock(ms: number): string {
  const clamped = Math.max(0, ms)
  if (clamped < TENTHS_BELOW_MS) {
    const tenths = Math.floor(clamped / 100)
    return `0:0${Math.floor(tenths / 10)}.${tenths % 10}`
  }
  // Round up so a clock showing 0:10 still has at least ten full seconds.
  const totalSeconds = Math.ceil(clamped / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`
}
