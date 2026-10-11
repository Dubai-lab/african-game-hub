// A card on its way across the table, carried by a hand: from a player to the pile when it is
// played, from the market to a player when it is drawn. Each player's hand has a cuff of its
// own colour, so it is clear at a glance whose hand it is. Drawn in code, like the cards.
//
// The flights show what has already happened; they decide nothing. A player who has asked
// their phone for less motion is shown the result without them.
import { useLayoutEffect, useRef } from 'react'
import type { Card } from '../../../supabase/functions/_shared/checkup'
import { CardBack, CardFace } from './cards'

export type Point = { x: number; y: number }
export type FlightPlan = {
  id: number
  /** The card carried, face up; null for a card drawn, which travels face down. */
  card: Card | null
  from: Point
  to: Point
  /** Seconds to wait before setting off. */
  delay: number
  /** Whose hand: their place at the table (0 for the first seat), for the colour of the cuff. */
  seatIndex: number
  /** The hand comes from the top of the screen (another player) or from the bottom (this player). */
  fromTop: boolean
}

export const FLIGHT_SECONDS = 0.6
/** One colour of cuff per seat: the hub's gold, hibiscus, palm and violet. */
const CUFFS = ['#f5b700', '#d1264f', '#0b7a55', '#6b2fa0']
const SKIN = '#8a5a3c'
const SKIN_SHADE = '#6f4630'

/** The fingers and forearm, drawn behind the card; the thumb is drawn over it. */
function HandBehind({ cuff }: { cuff: string }) {
  return (
    <svg viewBox="0 0 64 60" className="absolute left-1/2 top-[52%] w-[118%] -translate-x-1/2" aria-hidden="true">
      {/* Forearm and cuff. */}
      <rect x="20" y="34" width="24" height="26" rx="6" fill={SKIN} />
      <rect x="17" y="46" width="30" height="14" rx="3" fill={cuff} stroke="#0b0f24" strokeWidth="1.5" />
      {/* The palm, behind the card. */}
      <rect x="12" y="10" width="40" height="30" rx="12" fill={SKIN} stroke={SKIN_SHADE} strokeWidth="1.5" />
    </svg>
  )
}
function Thumb() {
  return (
    <svg viewBox="0 0 64 60" className="absolute left-1/2 top-[52%] w-[118%] -translate-x-1/2" aria-hidden="true">
      <rect x="23" y="4" width="13" height="26" rx="6.5" fill={SKIN} stroke={SKIN_SHADE} strokeWidth="1.5" transform="rotate(-18 29 17)" />
      <rect x="25.5" y="6" width="7" height="6" rx="3" fill="#e9c7b0" transform="rotate(-18 29 17)" />
    </svg>
  )
}

/** One card being carried. Removes itself (through onDone) when it has arrived. */
export function Flight({ plan, onDone }: { plan: FlightPlan; onDone: (id: number) => void }) {
  const element = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const node = element.current
    if (!node) return
    const dx = plan.to.x - plan.from.x
    const dy = plan.to.y - plan.from.y
    // A slight tilt on the way, straightening as the card is put down.
    const tilt = Math.max(-14, Math.min(14, dx / 12))
    const turn = plan.fromTop ? 180 : 0
    // The hand comes into view, carries the card across (quick at first, slowing as it is put
    // down), rests a moment on the pile or in the hand, then is gone.
    const animation = node.animate(
      [
        { transform: `translate(-50%, -50%) translate(0px, 0px) rotate(${turn + tilt}deg) scale(0.9)`, opacity: 0 },
        { transform: `translate(-50%, -50%) translate(0px, 0px) rotate(${turn + tilt}deg) scale(1)`, opacity: 1, offset: 0.1, easing: 'cubic-bezier(0.3, 0.6, 0.3, 1)' },
        { transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) rotate(${turn}deg) scale(1)`, opacity: 1, offset: 0.8 },
        { transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) rotate(${turn}deg) scale(1)`, opacity: 1, offset: 0.9 },
        { transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) rotate(${turn}deg) scale(1)`, opacity: 0 },
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
    <div ref={element} className="pointer-events-none fixed z-30 w-[4rem]" style={{ left: plan.from.x, top: plan.from.y, opacity: 0 }} data-testid="checkup-flight" data-card={plan.card ?? 'back'} aria-hidden="true">
      <HandBehind cuff={CUFFS[plan.seatIndex % CUFFS.length]!} />
      {/* The card stands the right way up for the reader whichever way the hand comes. */}
      <div className={plan.fromTop ? 'rotate-180' : ''}>{plan.card ? <CardFace card={plan.card} className="relative block w-full" /> : <CardBack className="relative block w-full" />}</div>
      <Thumb />
    </div>
  )
}

/** The middle of an element on the glass, or null when it is not on the page. */
export function centreOf(element: Element | null | undefined): Point | null {
  if (!element) return null
  const box = element.getBoundingClientRect()
  return box.width === 0 && box.height === 0 ? null : { x: box.left + box.width / 2, y: box.top + box.height / 2 }
}

export const wantsLessMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
