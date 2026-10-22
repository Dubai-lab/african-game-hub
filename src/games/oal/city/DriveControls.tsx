// One Africa Life: the player's car driven from the screen, as a car is driven: its steering wheel
// (turned by dragging round it, back to the middle when let go), its accelerator and brake (held),
// its gears (P, R, N, D), its handbrake, its indicators (left, right, both), its headlamps, its
// horn; its speed and its gear shown. The keys, a gamepad or a steering wheel do the same
// (./ownCar.ts's readInputs); what is pressed here is written straight to the car's controls.
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type Gear, ownCar } from './ownCar'

/** How far the wheel turns, either way, to full lock (radians: a little over a third of a turn). */
const LOCK = 2.4
const GEARS: Gear[] = ['P', 'R', 'N', 'D']

export function DriveControls({ seeThrough = false }: { seeThrough?: boolean }) {
  const { t } = useTranslation()
  const c = ownCar.controls
  const [, redraw] = useState(0)
  const [rot, setRot] = useState(0)
  const grab = useRef<{ cx: number; cy: number; last: number; acc: number } | null>(null)
  const rotRef = useRef(0)
  // The wheel springing back to the middle when let go; the dials read from the car.
  useEffect(() => {
    let raf = 0
    let prev = performance.now()
    let shown = ''
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - prev) / 1000)
      prev = now
      if (!grab.current && Math.abs(rotRef.current) > 0.001) {
        rotRef.current *= Math.exp(-dt * 7)
        if (Math.abs(rotRef.current) < 0.01) rotRef.current = 0
        c.wheel = rotRef.current / LOCK
      }
      // (The keys or a gamepad turning it: the wheel on the screen turns with them.)
      if (!grab.current && Math.abs(c.wheel * LOCK - rotRef.current) > 0.01) rotRef.current = c.wheel * LOCK
      setRot(rotRef.current)
      const now10 = `${Math.round(ownCar.kmh)}|${c.gear}|${c.indicator}|${ownCar.blink}|${c.lights}|${c.handbrake}|${c.gas > 0}|${c.brake > 0}`
      if (now10 !== shown) {
        shown = now10
        redraw((n) => n + 1)
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      Object.assign(c, { wheel: 0, gas: 0, brake: 0 })
    }
  }, [c])

  const angle = (e: ReactPointerEvent, g: { cx: number; cy: number }) => Math.atan2(e.clientX - g.cx, -(e.clientY - g.cy))
  const hold = (set: (on: boolean) => void) => ({
    onPointerDown: (e: ReactPointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      set(true)
      navigator.vibrate?.(8)
    },
    onPointerUp: () => set(false),
    onPointerCancel: () => set(false),
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  })
  const parkedWanting = c.gas > 0 && (c.gear === 'P' || c.gear === 'N')
  const blinkLeft = ownCar.blink && (c.indicator === 'left' || c.indicator === 'hazard')
  const blinkRight = ownCar.blink && (c.indicator === 'right' || c.indicator === 'hazard')
  // From the driver's seat, the wheel, gears and pedals faint (the real wheel and the hands seen through them).
  const faint = seeThrough ? 'opacity-40' : ''
  const toggle = (on: boolean) => `glass flex h-11 min-w-11 items-center justify-center rounded-full border px-3 text-sm font-semibold ${on ? 'border-edge bg-brand text-brand-ink' : 'border-line text-fg'}`

  return (
    <div data-hud className="pointer-events-none absolute inset-0 select-none" data-testid="oal-drive">
      {/* The dashboard: the indicators, the speed and the gear, the lamps. */}
      <div className="pointer-events-auto absolute inset-x-0 bottom-3 flex justify-center px-3">
        <div className="glass flex items-center gap-2 rounded-full border border-line px-2 py-1.5">
          <button type="button" aria-label={t('oal.city.car.drive.left')} aria-pressed={c.indicator === 'left'} className={toggle(c.indicator === 'left')} onClick={() => (c.indicator = c.indicator === 'left' ? 'off' : 'left')} data-testid="oal-drive-left">
            <span className={blinkLeft ? 'text-good' : 'opacity-60'}>◀</span>
          </button>
          <div className="flex min-w-24 flex-col items-center px-1 leading-none" data-testid="oal-drive-speed">
            <span className="text-2xl font-bold tabular-nums text-accent">{Math.round(ownCar.kmh)}</span>
            <span className="text-[11px] text-muted">km/h · {c.gear}</span>
          </div>
          <button type="button" aria-label={t('oal.city.car.drive.right')} aria-pressed={c.indicator === 'right'} className={toggle(c.indicator === 'right')} onClick={() => (c.indicator = c.indicator === 'right' ? 'off' : 'right')} data-testid="oal-drive-right">
            <span className={blinkRight ? 'text-good' : 'opacity-60'}>▶</span>
          </button>
          <button type="button" aria-label={t('oal.city.car.drive.hazard')} aria-pressed={c.indicator === 'hazard'} className={toggle(c.indicator === 'hazard')} onClick={() => (c.indicator = c.indicator === 'hazard' ? 'off' : 'hazard')} data-testid="oal-drive-hazard">
            ⚠
          </button>
          <button type="button" aria-label={t('oal.city.car.drive.lights')} aria-pressed={c.lights} className={toggle(c.lights)} onClick={() => (c.lights = !c.lights)} data-testid="oal-drive-lights">
            {t('oal.city.car.drive.lightsShort')}
          </button>
        </div>
      </div>

      {/* The steering wheel. */}
      <div
        className={`pointer-events-auto absolute bottom-20 left-3 h-36 w-36 touch-none rounded-full landscape:bottom-3 ${faint}`}
        role="slider"
        aria-label={t('oal.city.car.drive.wheel')}
        aria-valuemin={-100}
        aria-valuemax={100}
        aria-valuenow={Math.round((rot / LOCK) * 100)}
        data-testid="oal-drive-wheel"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          const r = e.currentTarget.getBoundingClientRect()
          const g = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, last: 0, acc: rotRef.current }
          g.last = angle(e, g)
          grab.current = g
        }}
        onPointerMove={(e) => {
          const g = grab.current
          if (!g) return
          const a = angle(e, g)
          let delta = a - g.last
          if (delta > Math.PI) delta -= 2 * Math.PI
          if (delta < -Math.PI) delta += 2 * Math.PI
          g.last = a
          g.acc = Math.max(-LOCK, Math.min(LOCK, g.acc + delta))
          rotRef.current = g.acc
          c.wheel = g.acc / LOCK
        }}
        onPointerUp={() => (grab.current = null)}
        onPointerCancel={() => (grab.current = null)}
      >
        <svg viewBox="-50 -50 100 100" className="h-full w-full drop-shadow-lg" style={{ transform: `rotate(${rot}rad)` }} aria-hidden>
          <circle r="44" fill="none" stroke="#1a1c24" strokeWidth="10" />
          <circle r="44" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
          <circle r="39" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
          <path d="M -40 4 Q -20 10 -11 6 M 40 4 Q 20 10 11 6 M 0 13 L 0 40" stroke="#22252e" strokeWidth="9" strokeLinecap="round" fill="none" />
          <circle r="14" fill="#2a2d38" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
          <circle r="5" fill="#f5b700" opacity="0.8" />
          <rect x="-2.5" y="-49" width="5" height="9" rx="2" fill="#f5b700" />
        </svg>
      </div>

      {/* The gears. */}
      <div className={`pointer-events-auto absolute bottom-20 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2 min-[420px]:left-auto min-[420px]:right-40 min-[420px]:translate-x-0 landscape:bottom-3 landscape:right-[11.5rem] ${faint}`}>
        <div className="glass flex flex-col gap-1 rounded-full border border-line p-1" role="radiogroup" aria-label={t('oal.city.car.drive.gear')}>
          {GEARS.map((g) => (
            <button
              key={g}
              type="button"
              role="radio"
              aria-checked={c.gear === g}
              aria-label={t(`oal.city.car.drive.gears.${g}`)}
              className={`flex h-9 w-9 items-center justify-center rounded-full text-base font-bold ${c.gear === g ? 'bg-brand text-brand-ink' : 'text-fg'} ${g === 'D' && parkedWanting ? 'animate-pulse ring-1 ring-[var(--color-brand)]' : ''}`}
              onClick={() => {
                // (Into R or out of it only near stopped, as a gearbox lets.)
                if ((g === 'R' || c.gear === 'R') && ownCar.kmh > 5) return
                c.gear = g
                navigator.vibrate?.(10)
              }}
              data-testid={`oal-drive-gear-${g}`}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {/* The handbrake, over the pedals: the brake (wide), the accelerator (tall). */}
      <div className={`pointer-events-auto absolute bottom-[13.5rem] right-3 landscape:bottom-[6.5rem] landscape:right-[4.5rem] ${faint}`}>
          <button type="button" aria-label={t('oal.city.car.drive.handbrake')} aria-pressed={c.handbrake} className={toggle(c.handbrake)} {...hold((on) => (c.handbrake = on))} data-testid="oal-drive-handbrake">
          {t('oal.city.car.drive.handbrakeShort')}
        </button>
      </div>
      <div className={`pointer-events-auto absolute bottom-20 right-3 flex items-end gap-3 landscape:bottom-3 ${faint}`}>
        <button type="button" aria-label={t('oal.city.car.drive.brake')} className={`glass h-20 w-16 touch-none rounded-2xl border ${c.brake > 0 ? 'border-edge bg-hibiscus' : 'border-line'}`} {...hold((on) => (c.brake = on ? 1 : 0))} data-testid="oal-drive-brake">
          <Ridges />
        </button>
        <button type="button" aria-label={t('oal.city.car.drive.gas')} className={`glass h-32 w-14 touch-none rounded-2xl border ${c.gas > 0 ? 'border-edge bg-palm' : 'border-line'}`} {...hold((on) => (c.gas = on ? 1 : 0))} data-testid="oal-drive-gas">
          <Ridges />
        </button>
      </div>
      {parkedWanting && (
        <p className="glass absolute inset-x-0 top-[25rem] mx-auto w-fit landscape:top-[7.75rem] rounded-full border border-line px-4 py-2 text-sm font-semibold" data-testid="oal-drive-hint">
          {t('oal.city.car.drive.putInD')}
        </p>
      )}
    </div>
  )
}

/** A pedal's rubber ridges. */
function Ridges() {
  return (
    <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 px-3" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="h-1 w-full rounded-full bg-white/25" />
      ))}
    </span>
  )
}
