// What the player holds: a joystick under the left thumb, two buttons under the right. The
// joystick appears wherever the thumb lands on the left half of the screen; a finger dragged
// anywhere else on the right half turns the camera. A keyboard works too (arrows or WASD,
// Space for the main button, J for the other, Q and E to turn the camera); a mouse dragged on
// the right half turns it as a finger does.
//
// The buttons mean different things with and without the ball, as on a real court:
//   main:   Shoot (hold, let go at the right moment)  /  Block (jump)
//   second: Cross (a crossover)                       /  Steal
//   pass (2v2): Pass to the teammate                   /  Call for the ball (the teammate has it)
import { type RefObject, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export type Pad = { mx: number; mz: number; main: boolean; second: boolean; pass: boolean }

const KNOB = 56

/**
 * Where a touch lands inside an element, in the element's own terms. When the game is drawn
 * turned a quarter (a phone held upright, see BasketballPracticePage), the screen's down is the
 * game's left: the touch is turned back the same way.
 */
function local(event: { clientX: number; clientY: number }, element: Element, turned: boolean) {
  const box = element.getBoundingClientRect()
  return turned ? { x: event.clientY - box.top, y: box.right - event.clientX } : { x: event.clientX - box.left, y: event.clientY - box.top }
}

export function Controls({
  pad,
  attacking,
  passing = null,
  canDunk = false,
  turned = false,
  onLook,
}: {
  pad: RefObject<Pad>
  attacking: boolean
  /** 2v2: what the third button does now, or null when it has nothing to do. */
  passing?: 'pass' | 'call' | null
  canDunk?: boolean
  turned?: boolean
  /** The camera finger moved by (dx, dy) pixels, in the game's own directions. */
  onLook?: (dx: number, dy: number) => void
}) {
  const lookFinger = useRef<{ id: number; x: number; y: number } | null>(null)
  const onLookRef = useRef(onLook)
  onLookRef.current = onLook
  const { t } = useTranslation()
  const [stick, setStick] = useState<{ x: number; y: number; dx: number; dy: number } | null>(null)
  const pointer = useRef<number | null>(null)
  const [main, setMain] = useState(false)
  const [second, setSecond] = useState(false)
  const [pass, setPass] = useState(false)

  // The pass button goes away (no teammate with the ball, not holding it): nothing left held.
  useEffect(() => {
    if (!passing && pad.current) pad.current.pass = false
  }, [passing, pad])

  // The keyboard, for a computer.
  useEffect(() => {
    const keys = new Set<string>()
    let turning = 0
    const spin = window.setInterval(() => {
      if (turning) onLookRef.current?.(turning * 9, 0)
    }, 16)
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
      turning = (keys.has('e') ? 1 : 0) - (keys.has('q') ? 1 : 0)
      p.second = keys.has('j') || keys.has('Shift')
      p.pass = keys.has('l')
      setPass(p.pass)
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
      window.clearInterval(spin)
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

  const hold = (which: 'main' | 'second' | 'pass', on: boolean) => {
    pad.current![which] = on
    if (which === 'main') setMain(on)
    else if (which === 'second') setSecond(on)
    else setPass(on)
  }

  const button = (which: 'main' | 'second' | 'pass', label: string, big: boolean, hot = false) => (
    <button
      type="button"
      data-testid={`pad-${which}`}
      aria-pressed={which === 'main' ? main : which === 'second' ? second : pass}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        hold(which, true)
      }}
      onPointerUp={() => hold(which, false)}
      onPointerCancel={() => hold(which, false)}
      onContextMenu={(event) => event.preventDefault()}
      className={`flex select-none items-center justify-center rounded-full border border-edge font-display font-extrabold shadow-lg transition-transform ${big ? 'size-24 text-lg' : 'size-16 text-sm'} ${(which === 'main' ? main : which === 'second' ? second : pass) ? 'scale-95 bg-brand text-brand-ink' : hot ? 'animate-pulse bg-hibiscus text-white shadow-[0_0_24px_rgba(209,38,79,0.8)]' : big ? 'glow-brand bg-brand/85 text-brand-ink' : 'glass text-fg'}`}
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
          const at = local(event, event.currentTarget, turned)
          moveStick(at.x, at.y, at)
        }}
        onPointerMove={(event) => {
          if (pointer.current !== event.pointerId || !stick) return
          const at = local(event, event.currentTarget, turned)
          moveStick(at.x, at.y, stick)
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
      {/* The rest of the right half: a finger dragged here turns the camera. Under the buttons. */}
      <div
        className="pointer-events-auto absolute bottom-0 right-0 top-16 w-1/2"
        data-testid="pad-look"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          const at = local(event, event.currentTarget, turned)
          lookFinger.current = { id: event.pointerId, ...at }
        }}
        onPointerMove={(event) => {
          const finger = lookFinger.current
          if (!finger || finger.id !== event.pointerId) return
          const at = local(event, event.currentTarget, turned)
          onLookRef.current?.(at.x - finger.x, at.y - finger.y)
          finger.x = at.x
          finger.y = at.y
        }}
        onPointerUp={() => (lookFinger.current = null)}
        onPointerCancel={() => (lookFinger.current = null)}
      />
      {/* The right thumb's buttons. */}
      <div className="pointer-events-auto absolute bottom-6 right-5 flex items-end gap-3 pb-[var(--safe-bottom)]">
        {passing && <div className="mb-16">{button('pass', passing === 'pass' ? t('basketball.controls.pass') : t('basketball.controls.call'), false)}</div>}
        {button('second', attacking ? t('basketball.controls.cross') : t('basketball.controls.steal'), false)}
        {button('main', attacking ? (canDunk ? t('basketball.controls.dunk') : t('basketball.controls.shoot')) : t('basketball.controls.block'), true, canDunk)}
      </div>
    </div>
  )
}
