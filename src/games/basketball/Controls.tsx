// What the player holds: a joystick under the left thumb, two buttons under the right. The
// joystick appears wherever the thumb lands on the left half of the screen. A keyboard works too
// (arrows or WASD, Space for the main button, J for the other).
//
// The buttons mean different things with and without the ball, as on a real court:
//   main:   Shoot (hold, let go at the right moment)  /  Block (jump)
//   second: Cross (a crossover)                       /  Steal
import { type RefObject, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export type Pad = { mx: number; mz: number; main: boolean; second: boolean }

const KNOB = 56

export function Controls({ pad, attacking }: { pad: RefObject<Pad>; attacking: boolean }) {
  const { t } = useTranslation()
  const [stick, setStick] = useState<{ x: number; y: number; dx: number; dy: number } | null>(null)
  const pointer = useRef<number | null>(null)
  const [main, setMain] = useState(false)
  const [second, setSecond] = useState(false)

  // The keyboard, for a computer.
  useEffect(() => {
    const keys = new Set<string>()
    const update = () => {
      const p = pad.current!
      const x = (keys.has('ArrowRight') || keys.has('d') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('a') ? 1 : 0)
      const z = (keys.has('ArrowDown') || keys.has('s') ? 1 : 0) - (keys.has('ArrowUp') || keys.has('w') ? 1 : 0)
      if (pointer.current === null) {
        const length = Math.hypot(x, z) || 1
        p.mx = x / length
        p.mz = z / length
      }
      p.main = keys.has(' ') || keys.has('k')
      p.second = keys.has('j') || keys.has('Shift')
      setMain(p.main)
      setSecond(p.second)
    }
    const down = (event: KeyboardEvent) => {
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(key)) event.preventDefault()
      keys.add(key)
      update()
    }
    const up = (event: KeyboardEvent) => {
      keys.delete(event.key.length === 1 ? event.key.toLowerCase() : event.key)
      update()
    }
    const clear = () => {
      keys.clear()
      update()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', clear)
    }
  }, [pad])

  const moveStick = (x: number, y: number, origin: { x: number; y: number }) => {
    let dx = x - origin.x
    let dy = y - origin.y
    const length = Math.hypot(dx, dy)
    if (length > KNOB) {
      dx = (dx / length) * KNOB
      dy = (dy / length) * KNOB
    }
    setStick({ ...origin, dx, dy })
    // Up the screen is toward the basket.
    pad.current!.mx = dx / KNOB
    pad.current!.mz = dy / KNOB
  }

  const hold = (which: 'main' | 'second', on: boolean) => {
    pad.current![which] = on
    if (which === 'main') setMain(on)
    else setSecond(on)
  }

  const button = (which: 'main' | 'second', label: string, big: boolean) => (
    <button
      type="button"
      data-testid={`pad-${which}`}
      aria-pressed={which === 'main' ? main : second}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        hold(which, true)
      }}
      onPointerUp={() => hold(which, false)}
      onPointerCancel={() => hold(which, false)}
      onContextMenu={(event) => event.preventDefault()}
      className={`flex select-none items-center justify-center rounded-full border border-edge font-display font-extrabold shadow-lg transition-transform ${big ? 'size-24 text-lg' : 'size-16 text-sm'} ${(which === 'main' ? main : second) ? 'scale-95 bg-brand text-brand-ink' : big ? 'glow-brand bg-brand/85 text-brand-ink' : 'glass text-fg'}`}
      style={{ touchAction: 'none' }}
    >
      {label}
    </button>
  )

  return (
    <div className="pointer-events-none absolute inset-0 select-none" style={{ touchAction: 'none' }}>
      {/* The left half: wherever the thumb lands, the joystick is there. */}
      <div
        className="pointer-events-auto absolute bottom-0 left-0 h-3/5 w-1/2"
        data-testid="pad-stick"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          pointer.current = event.pointerId
          const box = event.currentTarget.getBoundingClientRect()
          moveStick(event.clientX - box.left, event.clientY - box.top, { x: event.clientX - box.left, y: event.clientY - box.top })
        }}
        onPointerMove={(event) => {
          if (pointer.current !== event.pointerId || !stick) return
          const box = event.currentTarget.getBoundingClientRect()
          moveStick(event.clientX - box.left, event.clientY - box.top, stick)
        }}
        onPointerUp={() => {
          pointer.current = null
          setStick(null)
          pad.current!.mx = 0
          pad.current!.mz = 0
        }}
        onPointerCancel={() => {
          pointer.current = null
          setStick(null)
          pad.current!.mx = 0
          pad.current!.mz = 0
        }}
      >
        {stick ? (
          <div className="absolute size-32 rounded-full border border-white/30 bg-white/10" style={{ left: stick.x - 64, top: stick.y - 64 }} aria-hidden="true">
            <div className="absolute size-14 rounded-full bg-white/70 shadow-lg" style={{ left: 64 - 28 + stick.dx, top: 64 - 28 + stick.dy }} />
          </div>
        ) : (
          <p className="absolute bottom-8 left-8 text-sm font-semibold text-white/50">{t('basketball.controls.move')}</p>
        )}
      </div>
      {/* The right thumb's buttons. */}
      <div className="pointer-events-auto absolute bottom-6 right-5 flex items-end gap-3 pb-[var(--safe-bottom)]">
        {button('second', attacking ? t('basketball.controls.cross') : t('basketball.controls.steal'), false)}
        {button('main', attacking ? t('basketball.controls.shoot') : t('basketball.controls.block'), true)}
      </div>
    </div>
  )
}
