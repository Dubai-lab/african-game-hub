// A tile on its way across the table: out of the bag to a player's rack when tiles are shared
// out or drawn, from a rack onto the board when a word is laid, back into the bag when tiles
// are swapped. It is lifted, carried in a shallow arc, and set down.
//
// The flights show what has already happened; they decide nothing. A player who has asked
// their phone for less motion is shown the result without them.
import { useLayoutEffect, useRef } from 'react'
import type { Seat } from '../../../supabase/functions/_shared/words'
import { TileBack, TileFace } from './tiles'

export type Point = { x: number; y: number }
export type FlightPlan = {
  id: number
  /** The tile carried, face up; null for one that travels face down (drawn, or swapped). */
  face: { letter: string; blank: boolean } | null
  from: Point
  to: Point
  /** How wide the tile is where it lands, in pixels. */
  size: number
  /** Seconds to wait before setting off. */
  delay: number
  /** The rack it joins: that player is shown one more tile when it lands. */
  joins?: Seat
  /** The square it is laid on: the tile is shown there when it lands. */
  square?: number
}

export const FLIGHT_SECONDS = 0.5

/** One tile being carried. Removes itself (through onDone) when it has arrived. */
export function Flight({ plan, onDone }: { plan: FlightPlan; onDone: (id: number) => void }) {
  const element = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const node = element.current
    if (!node) return
    const dx = plan.to.x - plan.from.x
    const dy = plan.to.y - plan.from.y
    // Lifted off the table on the way (a little bigger, and a little higher than the straight
    // line), tilted towards where it is going, and straightened as it is put down.
    const tilt = Math.max(-16, Math.min(16, dx / 10))
    const lift = Math.min(28, 10 + Math.hypot(dx, dy) / 12)
    const at = (part: number, rise: number, turn: number, scale: number) => `translate(-50%, -50%) translate(${dx * part}px, ${dy * part - rise}px) rotate(${turn}deg) scale(${scale})`
    const animation = node.animate(
      [
        { transform: at(0, 0, 0, 0.7), opacity: 0 },
        { transform: at(0, lift * 0.6, tilt, 1.25), opacity: 1, offset: 0.12, easing: 'cubic-bezier(0.3, 0.6, 0.3, 1)' },
        { transform: at(0.55, lift, tilt, 1.3), opacity: 1, offset: 0.55, easing: 'cubic-bezier(0.3, 0, 0.4, 1)' },
        { transform: at(1, 0, 0, 1), opacity: 1, offset: 0.92 },
        { transform: at(1, 0, 0, 1), opacity: 1 },
      ],
      { duration: FLIGHT_SECONDS * 1000, delay: plan.delay * 1000, easing: 'linear', fill: 'both' },
    )
    animation.onfinish = () => onDone(plan.id)
    // Leaving the page mid-flight just stops it. (It is not reported as arrived: in development
    // React sets every effect up twice, and the first, cancelled, run must not end the flight.)
    return () => {
      animation.onfinish = null
      animation.cancel()
    }
    // A flight is planned once and flown once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={element}
      className="pointer-events-none fixed z-30 drop-shadow-[0_6px_6px_rgba(11,15,36,0.35)]"
      style={{ left: plan.from.x, top: plan.from.y, width: plan.size, fontSize: plan.size * 0.56, opacity: 0 }}
      data-testid="words-flight"
      aria-hidden="true"
    >
      {plan.face ? <TileFace letter={plan.face.letter} blank={plan.face.blank} className="w-full" small /> : <TileBack className="w-full" />}
    </div>
  )
}

/** The middle of an element on the glass and how wide it is, or null when it is not on the page. */
export function placeOf(element: Element | null | undefined): (Point & { width: number }) | null {
  if (!element) return null
  const box = element.getBoundingClientRect()
  return box.width === 0 && box.height === 0 ? null : { x: box.left + box.width / 2, y: box.top + box.height / 2, width: box.width }
}

export const wantsLessMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
