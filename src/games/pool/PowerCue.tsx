import { useRef, useState, useContext } from 'react'
import { Sideways, travelDown } from './sideways'
import { type CueId, cueGradient } from './cues'

// The cue beside the table: put a finger on it, pull it back as far as the shot should be hard,
// and let go to shoot. Sliding back to the top and letting go cancels.

/** How far along the track a full-power pull reaches. */
const FULL_PULL = 0.55
/** Below this, letting go does not shoot. */
const LEAST = 0.04

type Props = {
  /** It is this player's shot. */
  ready: boolean
  /** Something must be done first (a pocket called): the cue cannot be pulled yet. */
  blocked: boolean
  label: string
  /** The cue is being drawn back: 0 to 1. */
  onPull: (power: number) => void
  /** Let go: shoot with this power, 0 to 1. */
  onShoot: (power: number) => void
  className?: string
  cue: CueId
}

export function PowerCue({ ready, blocked, label, onPull, onShoot, className = '', cue }: Props) {
  const track = useRef<HTMLDivElement>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  // On a screen the game has turned, pulling "down" the cue is a pull across the glass.
  const sideways = useContext(Sideways)
  const [pull, setPull] = useState(0)
  const usable = ready && !blocked

  const set = (power: number) => {
    setPull(power)
    onPull(power)
  }
  const at = (event: { clientX: number; clientY: number }) => {
    const height = track.current?.clientHeight ?? 1
    const from = start.current ?? { x: event.clientX, y: event.clientY }
    return Math.min(1, Math.max(0, travelDown(from, event.clientX, event.clientY, sideways) / (height * FULL_PULL)))
  }
  const release = (power: number) => {
    start.current = null
    set(0)
    if (power >= LEAST) onShoot(power)
  }

  return (
    <div
      ref={track}
      role="slider"
      tabIndex={usable ? 0 : -1}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pull * 100)}
      aria-disabled={!usable}
      data-testid={ready ? 'pool-power' : undefined}
      className={`relative w-11 shrink-0 touch-none select-none overflow-hidden rounded-xl border-2 border-ink bg-[#161a2e] outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary ${usable ? 'cursor-grab active:cursor-grabbing' : 'opacity-45'} ${className}`}
      onPointerDown={(event) => {
        if (!usable) return
        event.currentTarget.setPointerCapture(event.pointerId)
        start.current = { x: event.clientX, y: event.clientY }
      }}
      onPointerMove={(event) => {
        if (start.current !== null) set(at(event))
      }}
      onPointerUp={(event) => {
        if (start.current !== null) release(at(event))
      }}
      onPointerCancel={() => {
        start.current = null
        set(0)
      }}
      onKeyDown={(event) => {
        if (!usable) return
        if (event.key === 'ArrowDown') set(Math.min(1, pull + 0.05))
        else if (event.key === 'ArrowUp') set(Math.max(0, pull - 0.05))
        else if (event.key === 'Enter' || event.key === ' ') release(pull)
        else return
        event.preventDefault()
      }}
    >
      {/* How hard: fills from the top as the cue comes back, green to red. */}
      <div className="absolute inset-x-0 top-0 opacity-80" style={{ height: `${pull * 100}%`, background: 'linear-gradient(to bottom, #2fb574, #f6c400 60%, #de1c2c)' }} aria-hidden="true" />
      {/* Marks along the track. */}
      {[0.2, 0.4, 0.6, 0.8].map((mark) => (
        <span key={mark} className="absolute inset-x-1.5 h-px bg-white/25" style={{ top: `${mark * 100}%` }} aria-hidden="true" />
      ))}
      {/* The cue: chalked tip, ferrule, maple shaft, wrapped butt. */}
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-2 h-[62%] w-2.5 rounded-full shadow-[2px_2px_3px_rgba(0,0,0,0.5)]"
        style={{
          transform: `translate(-50%, ${pull * (FULL_PULL / 0.62) * 100}%)`,
          background: cueGradient(cue),
        }}
      />
      <span className="absolute inset-x-0 bottom-1 text-center text-xs font-bold tabular-nums text-white" aria-hidden="true">
        {Math.round(pull * 100)}
      </span>
    </div>
  )
}
