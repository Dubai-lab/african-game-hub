import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { notationOf, type Pits, type Played, type Side } from '../../../supabase/functions/_shared/oware'
import { collectSound, dropSound, pickUpSound } from './sound'

// The board. It shows a position and the pits that may be played, reports the pit the player
// chooses, and plays each move out the way it is played by hand; it decides nothing about the
// game (the server has already judged the move and what it took).
//
//   1. The seeds are lifted out of the pit into a hand that hovers over the board.
//   2. The hand goes round, pit by pit, dropping one seed in each.
//   3. Seeds won are gathered into the winner's store at their end of the board. A player
//      gathers their own by tapping the pits that glow; the opponent's are gathered for them.
//   4. At the end of a game decided by sharing out, the seeds left go to their owners.
//
// The player's own row is always the near one, read from their left, so seeds travel left to
// right along the near row and right to left along the far one (anticlockwise).

export type BoardMove = Played & {
  /** The board, and what each player had taken, before this move. */
  from: Pits
  storesBefore: Record<Side, number>
  ply: number
}

type Props = {
  /** What the pits hold once the move is over. */
  pits: Pits
  /** What each player has taken once the move is over. */
  stores: Record<Side, number>
  /** The side whose row is nearest the player. */
  near: Side
  /** The pits that may be played now (empty when it is not this player's turn). */
  playable: number[]
  onPlay: (pit: number) => void
  /** The move that led to this position, played out when it is new. */
  lastMove: BoardMove | null
  /** The side whose winnings the person at this screen gathers by hand. Null for someone watching. */
  collector: Side | null
  /** When the game ended by sharing out the seeds: what each player ends with. */
  shareOut: Record<Side, number> | null
  animate: boolean
  /** True while a move is being played out: nothing may be played until it is over. */
  onBusyChange?: (busy: boolean) => void
  /** What the stores show at this moment (the players' cards show the same). */
  onStoresShown?: (stores: Record<Side, number>) => void
}

// The grey and brown of the nicker seeds the game is played with.
const SEED_TONES = [
  ['#c9c1b1', '#8a8172'],
  ['#9c8f7d', '#5e5345'],
  ['#b9b2a3', '#7d7466'],
  ['#8a7a66', '#4f4335'],
] as const
const SHOWN = 20
const golden = Math.PI * (3 - Math.sqrt(5))

// How long things take. A move of a few seeds takes about two seconds, as it does by hand.
const LIFT_MS = 420
const STEP_MS = 340
const FAST_STEP_MS = 210
const HOP_MS = 220
const BEFORE_CAPTURE_MS = 420
const FLY_MS = 520
const AUTO_GATHER_MS = 450
/** A player who does not gather their seeds has them gathered after this long. */
const GATHER_WAIT_MS = 15_000

const seedScale = (count: number) => (count <= 4 ? 1.55 : count <= 7 ? 1.35 : count <= 12 ? 1.12 : 0.95)

/** Where each seed lies in a pit: a loose spiral, the same every time for the same count. */
const spots = (count: number) => {
  const scale = seedScale(count)
  return Array.from({ length: Math.min(count, SHOWN) }, (_, k) => {
    const r = Math.min(31, 7.4 * scale * Math.sqrt(k + 0.35))
    const a = k * golden
    return { x: 50 + r * Math.cos(a), y: 50 + r * Math.sin(a), rot: (k * 53) % 180, tone: SEED_TONES[k % SEED_TONES.length]!, scale }
  })
}

/** The pits of one side, from its owner's left. */
const rowOf = (side: Side) => [0, 1, 2, 3, 4, 5].map((i) => (side === 's' ? 0 : 6) + i)

function Seed({ tone, x = 0, y = 0, rot = 0, scale = 1 }: { tone: readonly [string, string]; x?: number; y?: number; rot?: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${scale})`}>
      <ellipse cx="0.8" cy="1.6" rx="8" ry="6.3" fill="rgba(0,0,0,0.35)" />
      <ellipse rx="8" ry="6.3" fill={tone[0]} stroke={tone[1]} strokeWidth="1.2" />
      <ellipse cx="-2.4" cy="-1.8" rx="2.6" ry="1.6" fill="rgba(255,255,255,0.45)" />
    </g>
  )
}

function Pit({ seeds, glow, lit, gather, from }: { seeds: number; glow: boolean; lit: boolean; gather: boolean; from: boolean }) {
  return (
    <svg viewBox="0 0 100 100" className="block size-full" aria-hidden="true">
      <circle cx="50" cy="50" r="46" fill="url(#oware-hollow)" />
      <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth="2" />
      {glow && <circle cx="50" cy="50" r="45" fill="none" stroke="#f5b700" strokeWidth="5" opacity="0.95" />}
      {from && !glow && <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(245,183,0,0.55)" strokeWidth="3" strokeDasharray="6 5" />}
      {lit && <circle cx="50" cy="50" r="42" fill="rgba(255,236,170,0.3)" />}
      {gather && <circle className="oware-gather" cx="50" cy="50" r="45" fill="rgba(79,214,156,0.25)" stroke="#4fd69c" strokeWidth="5" />}
      {spots(seeds).map((spot, k) => (
        <Seed key={k} tone={spot.tone} x={spot.x} y={spot.y} rot={spot.rot} scale={spot.scale} />
      ))}
    </svg>
  )
}

/** A player's store: a trough at their end of the board, with the seeds they have won in it. */
function Store({ count, label, highlight }: { count: number; label: string; highlight: boolean }) {
  const shown = Math.min(count, 48)
  return (
    <div className={`relative flex h-11 items-center gap-2 rounded-full px-3 transition-shadow ${highlight ? 'shadow-[0_0_0_3px_rgba(79,214,156,0.75)]' : ''}`} style={{ background: 'linear-gradient(180deg, #3a1c0b, #4f2810)' }}>
      <svg viewBox="0 0 300 40" preserveAspectRatio="none" className="h-full min-w-0 flex-1" aria-hidden="true">
        {Array.from({ length: shown }, (_, k) => {
          const x = 10 + ((k * 0.618034 * 280) % 280)
          const y = 13 + ((k * 7) % 3) * 7
          return <Seed key={k} tone={SEED_TONES[k % SEED_TONES.length]!} x={x} y={y} rot={(k * 61) % 180} scale={0.95} />
        })}
      </svg>
      <span className="shrink-0 font-display text-lg font-extrabold tabular-nums text-[#fff4dc]" aria-label={label}>
        {count}
      </span>
    </div>
  )
}

type Point = { x: number; y: number }
type Flyer = { id: number; from: Point; to: Point; delay: number; tone: readonly [string, string] }
type View = { pits: Pits; stores: Record<Side, number> }
type Hand = { pit: number; count: number }

let flyerId = 1
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** One seed flying from a pit to a store, in an arc. Removes itself when it lands. */
function FlyingSeed({ flyer, onLanded }: { flyer: Flyer; onLanded: (id: number) => void }) {
  const ref = useRef<SVGSVGElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const dx = flyer.to.x - flyer.from.x
    const dy = flyer.to.y - flyer.from.y
    const animation = el.animate(
      [
        { transform: 'translate(0px, 0px) scale(1)' },
        { transform: `translate(${dx / 2}px, ${dy / 2 - 46}px) scale(1.25)`, offset: 0.5 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.9)` },
      ],
      { duration: FLY_MS, delay: flyer.delay, easing: 'cubic-bezier(0.45, 0, 0.3, 1)', fill: 'both' },
    )
    animation.onfinish = () => onLanded(flyer.id)
    return () => animation.cancel()
  }, [flyer, onLanded])
  return (
    <svg ref={ref} viewBox="-12 -12 24 24" className="pointer-events-none absolute z-20 size-5" style={{ left: flyer.from.x - 10, top: flyer.from.y - 10 }} aria-hidden="true">
      <Seed tone={flyer.tone} />
    </svg>
  )
}

export function OwareBoard({ pits, stores, near, playable, onPlay, lastMove, collector, shareOut, animate, onBusyChange, onStoresShown }: Props) {
  const { t } = useTranslation()
  const far: Side = near === 's' ? 'n' : 's'
  const nearRow = rowOf(near)
  const farRow = [...rowOf(far)].reverse()

  const [view, setView] = useState<View>({ pits, stores })
  const [busy, setBusy] = useState(false)
  const [hand, setHand] = useState<Hand | null>(null)
  const [lit, setLit] = useState<number | null>(null)
  const [gathering, setGathering] = useState<number[]>([])
  const [flyers, setFlyers] = useState<Flyer[]>([])

  const board = useRef<HTMLDivElement>(null)
  const pitEls = useRef(new Map<number, HTMLButtonElement>())
  const storeEls = useRef<Partial<Record<Side, HTMLDivElement>>>({})
  const viewNow = useRef(view)
  const run = useRef(0)
  /** True from the moment a move starts being played out until it is over (set before any render). */
  const playing = useRef(false)
  const gathered = useRef<(() => void) | null>(null)
  const landing = useRef(new Map<number, () => void>())

  const centre = useCallback((el: Element | undefined): Point => {
    const box = board.current?.getBoundingClientRect()
    const r = el?.getBoundingClientRect()
    if (!box || !r) return { x: 0, y: 0 }
    return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2 }
  }, [])

  const update = useCallback((change: (v: View) => View) => {
    viewNow.current = change(viewNow.current)
    setView(viewNow.current)
  }, [])

  const onLanded = useCallback((id: number) => {
    setFlyers((list) => list.filter((f) => f.id !== id))
    landing.current.get(id)?.()
    landing.current.delete(id)
  }, [])

  /** Moves the seeds of one pit into a player's store, flying when there is motion. */
  const gather = useCallback(
    async (pit: number, side: Side, moving: boolean) => {
      const count = viewNow.current.pits[pit]!
      if (count === 0) return
      update((v) => ({ ...v, pits: v.pits.map((seeds, i) => (i === pit ? 0 : seeds)) }))
      collectSound()
      if (moving) {
        const from = centre(pitEls.current.get(pit))
        const to = centre(storeEls.current[side])
        const flying = Array.from(
          { length: Math.min(count, 10) },
          (_, k): Flyer => ({ id: flyerId++, from: { x: from.x + ((k * 7) % 13) - 6, y: from.y + ((k * 5) % 11) - 5 }, to, delay: k * 55, tone: SEED_TONES[k % SEED_TONES.length]! }),
        )
        const last = flying.at(-1)!
        const landed = new Promise<void>((resolve) => landing.current.set(last.id, resolve))
        setFlyers((list) => [...list, ...flying])
        // Never wait for ever: a seed whose flight is cut short still counts.
        await Promise.race([landed, wait(FLY_MS + flying.length * 55 + 400)])
      }
      update((v) => ({ ...v, stores: { ...v.stores, [side]: v.stores[side] + count } }))
    },
    [centre, update],
  )

  // Plays out a move that has just been made. A move already being played out gives way to a
  // newer one, which starts from its own position, so nothing is lost.
  const move = useRef(lastMove)
  move.current = lastMove
  const target = useRef({ pits, stores, shareOut, collector })
  target.current = { pits, stores, shareOut, collector }
  const moveKey = lastMove ? `${lastMove.ply}:${lastMove.pit}` : '0'
  const drawnPly = useRef<number | null>(null)

  useEffect(() => {
    const id = ++run.current
    const live = () => id === run.current
    const played = move.current
    const ply = played?.ply ?? 0
    const previous = drawnPly.current
    drawnPly.current = ply
    landing.current.clear()
    gathered.current = null
    setFlyers([])
    setHand(null)
    setLit(null)
    setGathering([])

    // Only a move just made is played out: not one stepped to in the record of the game.
    if (!played || previous === null || ply !== previous + 1) {
      playing.current = false
      update(() => ({ pits: target.current.shareOut ? target.current.pits.map(() => 0) : target.current.pits, stores: target.current.shareOut ?? target.current.stores }))
      setBusy(false)
      return
    }

    playing.current = true
    void (async () => {
      setBusy(true)
      const mover = played.side
      const sown = [...played.from]
      sown[played.pit] = 0
      for (const p of played.sown) sown[p]! += 1
      const seeds = played.from[played.pit]!

      if (animate) {
        // 1. Lift the seeds out of the pit.
        update(() => ({ pits: [...played.from], stores: { ...played.storesBefore } }))
        setLit(played.pit)
        await wait(140)
        if (!live()) return
        pickUpSound()
        update((v) => ({ ...v, pits: v.pits.map((s, i) => (i === played.pit ? 0 : s)) }))
        setHand({ pit: played.pit, count: seeds })
        await wait(LIFT_MS)
        // 2. Round the board, one seed in each pit.
        const step = played.sown.length >= 12 ? FAST_STEP_MS : STEP_MS
        for (let k = 0; k < played.sown.length; k++) {
          if (!live()) return
          const pit = played.sown[k]!
          setHand({ pit, count: seeds - k })
          setLit(pit)
          await wait(HOP_MS)
          if (!live()) return
          update((v) => ({ ...v, pits: v.pits.map((s, i) => (i === pit ? s + 1 : s)) }))
          setHand({ pit, count: seeds - k - 1 })
          dropSound()
          pitEls.current.get(pit)?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.09)' }, { transform: 'scale(1)' }], { duration: 200, easing: 'ease-out' })
          await wait(step - HOP_MS)
        }
        setHand(null)
        setLit(null)
      } else {
        update(() => ({ pits: sown, stores: { ...played.storesBefore } }))
      }
      if (!live()) return

      // 3. The seeds won go to the mover's store.
      if (played.captured.length > 0) {
        if (animate) await wait(BEFORE_CAPTURE_MS)
        if (!live()) return
        if (target.current.collector === mover) {
          // This player gathers their own: the pits glow until they have been tapped.
          setGathering(played.captured)
          await new Promise<void>((resolve) => {
            gathered.current = resolve
            setTimeout(resolve, GATHER_WAIT_MS)
          })
          if (!live()) return
          gathered.current = null
          // Any not tapped in time are gathered for them.
          for (const pit of played.captured) if (viewNow.current.pits[pit]! > 0) await gather(pit, mover, animate)
          setGathering([])
        } else {
          for (const pit of played.captured) {
            if (!live()) return
            await gather(pit, mover, animate)
            if (animate) await wait(AUTO_GATHER_MS)
          }
        }
      }

      // 4. A game decided by sharing out: the seeds left go to their owners.
      if (target.current.shareOut && live()) {
        if (animate) await wait(600)
        for (const pit of [...rowOf('s'), ...rowOf('n')]) {
          if (!live()) return
          if (viewNow.current.pits[pit]! > 0) await gather(pit, pit < 6 ? 's' : 'n', animate)
        }
      }
      if (animate) await wait(200)
      if (!live()) return
      playing.current = false
      setHand(null)
      setLit(null)
      setGathering([])
      setBusy(false)
    })()
    return () => {
      // A newer move takes over: stop waiting for this one's seeds to be gathered.
      gathered.current?.()
    }
    // The move is read from refs: only a different move (or motion turned on or off) starts again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveKey, animate])

  // Not playing anything out: show exactly what the game says (a reload, a step through the record).
  useEffect(() => {
    if (!playing.current) update(() => ({ pits: shareOut ? pits.map(() => 0) : pits, stores: shareOut ?? stores }))
  }, [busy, pits, stores, shareOut, update])

  useEffect(() => onBusyChange?.(busy), [busy, onBusyChange])
  useEffect(() => onStoresShown?.(view.stores), [view.stores, onStoresShown])

  const tapToGather = async (pit: number) => {
    if (!gathering.includes(pit) || !collector) return
    const left = gathering.filter((p) => p !== pit)
    setGathering(left)
    await gather(pit, collector, animate)
    if (left.length === 0) gathered.current?.()
  }

  const cell = (pit: number, row: 'near' | 'far') => {
    const seeds = view.pits[pit]!
    const can = !busy && playable.includes(pit)
    const toGather = gathering.includes(pit)
    const label = toGather ? t('oware.board.gather', { pit: notationOf(pit), count: seeds }) : t('oware.board.pit', { pit: notationOf(pit), count: seeds })
    const count = (
      <span className={`block text-center text-sm font-bold tabular-nums ${seeds === 0 ? 'text-[#e8d6b8]/50' : 'text-[#fff4dc]'}`} aria-hidden="true">
        {seeds}
      </span>
    )
    return (
      <div key={pit} className="flex min-w-0 flex-col items-stretch gap-0.5">
        {row === 'far' && count}
        <button
          type="button"
          ref={(el) => {
            if (el) pitEls.current.set(pit, el)
            else pitEls.current.delete(pit)
          }}
          data-pit={pit}
          data-seeds={seeds}
          data-playable={can}
          data-gather={toGather}
          disabled={!can && !toGather}
          aria-label={label}
          onClick={() => (toGather ? void tapToGather(pit) : onPlay(pit))}
          className={`relative aspect-square w-full rounded-full transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f5b700] ${can || toGather ? 'cursor-pointer active:scale-95' : 'cursor-default'}`}
        >
          <Pit seeds={seeds} glow={can} lit={lit === pit} gather={toGather} from={!busy && lastMove?.pit === pit} />
        </button>
        {row === 'near' && count}
      </div>
    )
  }

  const handAt = hand ? centre(pitEls.current.get(hand.pit)) : null
  const toGatherCount = gathering.reduce((sum, p) => sum + view.pits[p]!, 0)

  return (
    <div
      ref={board}
      data-testid="oware-board"
      data-near={near}
      data-busy={busy}
      className="relative w-full select-none rounded-[1.6rem] p-2.5 shadow-[0_14px_30px_-10px_rgba(0,0,0,0.7)] sm:p-3.5"
      style={{ background: 'linear-gradient(160deg, #a5642e 0%, #7a4320 55%, #5c2f14 100%)' }}
    >
      <svg width="0" height="0" className="absolute" aria-hidden="true">
        <defs>
          <radialGradient id="oware-hollow" cx="45%" cy="40%" r="62%">
            <stop offset="0%" stopColor="#4a250f" />
            <stop offset="70%" stopColor="#331809" />
            <stop offset="100%" stopColor="#5a2e12" />
          </radialGradient>
        </defs>
      </svg>
      {/* The grain of the wood, and a lit top edge. */}
      <div className="pointer-events-none absolute inset-0 rounded-[1.6rem] opacity-25" style={{ background: 'repeating-linear-gradient(100deg, transparent 0 9px, rgba(0,0,0,0.18) 9px 11px, transparent 11px 23px)' }} aria-hidden="true" />
      <div className="pointer-events-none absolute inset-x-6 top-0.5 h-px bg-white/30" aria-hidden="true" />

      <div className="relative flex flex-col gap-2">
        <div
          ref={(el) => {
            if (el) storeEls.current[far] = el
          }}
          data-testid={`store-${far}`}
          data-count={view.stores[far]}
        >
          <Store count={view.stores[far]} label={t('oware.board.store', { count: view.stores[far] })} highlight={false} />
        </div>
        <div className="grid grid-cols-6 gap-x-1.5 gap-y-2 sm:gap-x-2.5" role="group" aria-label={t('oware.board.label')}>
          {farRow.map((pit) => cell(pit, 'far'))}
          {/* The line down the middle of the board, where the board says what to do. */}
          <div className="relative col-span-6 flex h-1 items-center justify-center">
            <div className="h-1 w-full rounded-full bg-black/25" aria-hidden="true" />
            {/* Laid over the line, so the board never moves when it appears. */}
            {gathering.length > 0 && (
              <p role="status" className="oware-gather-hint absolute z-10 whitespace-nowrap rounded-full bg-[#0b3d2a] px-3 py-1 text-center text-sm font-bold text-[#c8f7e0] shadow-[0_4px_12px_rgba(0,0,0,0.45)]">
                {t('oware.board.tapToGather', { count: toGatherCount })}
              </p>
            )}
          </div>
          {nearRow.map((pit) => cell(pit, 'near'))}
        </div>
        <div
          ref={(el) => {
            if (el) storeEls.current[near] = el
          }}
          data-testid={`store-${near}`}
          data-count={view.stores[near]}
        >
          <Store count={view.stores[near]} label={t('oware.board.store', { count: view.stores[near] })} highlight={gathering.length > 0} />
        </div>
      </div>

      {/* The hand, carrying the seeds round the board. */}
      {hand && handAt && (
        <div
          className="pointer-events-none absolute left-0 top-0 z-10 flex size-14 items-center justify-center transition-transform duration-200 ease-out"
          style={{ transform: `translate(${handAt.x - 28}px, ${handAt.y - 52}px)` }}
          aria-hidden="true"
        >
          <svg viewBox="0 0 100 100" className="size-full drop-shadow-[0_6px_6px_rgba(0,0,0,0.55)]">
            {spots(hand.count).map((spot, k) => (
              <Seed key={k} tone={spot.tone} x={spot.x} y={spot.y} rot={spot.rot} scale={spot.scale} />
            ))}
          </svg>
          {hand.count > 0 && <span className="absolute -end-1 -top-1 flex min-w-6 justify-center rounded-full bg-brand px-1.5 text-sm font-extrabold text-brand-ink shadow">{hand.count}</span>}
        </div>
      )}

      {flyers.map((flyer) => (
        <FlyingSeed key={flyer.id} flyer={flyer} onLanded={onLanded} />
      ))}
    </div>
  )
}
