// One Africa Life: the town's map, as in a game. A drawing of the real town (from OpenStreetMap,
// made by scripts/oal/makeTownMap.py: its roads, the sea, its rivers, lagoons and swamps, its
// airfields), dragged to move and pinched (or wheeled) to zoom; the game's places on it as
// marks, the streets built in 3D as one mark until near enough to show their own places; the
// player as an arrow. A mark tapped: what it is, and Go here (or Walk here, on a 3D street). The
// same places as a list too, for those who would rather read one.
import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/core/ui/Button'
import { Skeleton } from '@/core/ui/Skeleton'

type Line = { p: number[]; n?: string }
type TownMap = {
  bounds: [number, number, number, number]
  roads: { major: Line[]; middle: Line[]; minor: Line[] }
  water: number[][]
  wetland: number[][]
  rivers: { p: number[]; w: number }[]
  sea: number[]
  airfields: number[][]
  buildings: number[][]
  places: Record<string, { x: number; y: number; places?: Record<string, [number, number]> }>
  far: Record<string, { x: number; y: number; km: number }>
}

/** A place on the map, as the world screen knows it. */
export type Mark = { area: string; place: string; name: string; walk?: boolean }
/** Where the player is: at a place, or on a 3D street at a point in its own metres (facing as
 * the street's yaw: forward is (sin, -cos)). */
export type MapPoint = { area: string; place?: string; local?: { x: number; y: number; facing: number } }

/** The town's map file for a game town (Monrovia, Accra, Kumasi, Voinjama). */
export const mapOf = (town: string) => town.toLowerCase()

function useTownMap(town: string) {
  return useQuery({
    queryKey: ['oal-map', town],
    staleTime: Infinity,
    queryFn: async () => {
      const res = await fetch(`/oal/maps/${mapOf(town)}.v2.json`)
      if (!res.ok) throw new Error(String(res.status))
      return (await res.json()) as TownMap
    },
  })
}

const path = (p: number[], close = false) => {
  let d = ''
  for (let i = 0; i < p.length; i += 2) d += `${i ? 'L' : 'M'}${p[i]} ${-p[i + 1]!}`
  return close ? `${d}Z` : d
}

/** Where a mark is on the map: a 3D street's own place, the street itself, or a town place. */
export function markAt(map: TownMap, mark: Pick<Mark, 'area' | 'place'>): [number, number] | null {
  const area = map.places[mark.area]
  if (area?.places?.[mark.place]) return area.places[mark.place]!
  if (area) return [area.x, area.y]
  const own = map.places[mark.place] ?? map.far[mark.place]
  return own ? [own.x, own.y] : null
}

export function MapView({ town, marks, areaNames, me, onGo, onClose, list }: { town: string; marks: Mark[]; areaNames: Record<string, string>; me: MapPoint | null; onGo: (mark: Mark, walk: boolean) => void; onClose: () => void; list: ReactNode }) {
  const { t } = useTranslation()
  const map = useTownMap(town)
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 400, h: 700 })
  // The view: the map point at the screen's centre, and metres per screen pixel.
  const [view, setView] = useState<{ x: number; y: number; mpp: number } | null>(null)
  const [chosen, setChosen] = useState<Mark | null>(null)
  const [showList, setShowList] = useState(false)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ d: number; mpp: number } | null>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const meAt = useMemo(() => {
    if (!map.data || !me) return null
    const area = map.data.places[me.area]
    if (me.local && area) return { x: area.x + me.local.x, y: area.y + me.local.y, facing: me.local.facing }
    const at = markAt(map.data, { area: me.area, place: me.place ?? me.area })
    return at ? { x: at[0], y: at[1], facing: null as number | null } : null
  }, [map.data, me])
  // First seen: centred on the player (or the town), a couple of kilometres across.
  useEffect(() => {
    if (map.data && !view) setView({ x: meAt?.x ?? 0, y: meAt?.y ?? 0, mpp: 2200 / Math.max(320, size.w) })
  }, [map.data, view, meAt, size.w])

  // Areas with several places (a 3D street, a town's centre) show as one mark when far.
  const groups = useMemo(() => new Set(marks.map((m) => m.area).filter((a, i, all) => all.indexOf(a) !== i)), [marks])
  const placed = useMemo(() => {
    if (!map.data) return []
    const out: { mark: Mark; at: [number, number] }[] = []
    for (const m of marks) {
      const at = markAt(map.data, m)
      if (!at) continue
      // A town's places all at its centre: set round it, a few doors apart.
      const area = map.data.places[m.area]
      if (groups.has(m.area) && area && !area.places) {
        const same = marks.filter((x) => x.area === m.area)
        const k = same.indexOf(m)
        out.push({ mark: m, at: [at[0] + Math.cos((k / same.length) * 2 * Math.PI) * 35, at[1] + Math.sin((k / same.length) * 2 * Math.PI) * 35] })
      } else out.push({ mark: m, at })
    }
    return out
  }, [map.data, marks, groups])

  if (map.isError) return <Shell title={t('oal.world.mapTitle', { town })} onClose={onClose} onList={() => setShowList(true)}>{list}</Shell>
  const v = view
  const toScreen = (x: number, y: number) => (v ? { left: size.w / 2 + (x - v.x) / v.mpp, top: size.h / 2 - (y - v.y) / v.mpp } : { left: 0, top: 0 })
  const near = v ? v.mpp < 1.2 : false
  // Grouped areas: one mark each when far, their places when near.
  const shown = placed.filter(({ mark }) => (groups.has(mark.area) ? near : true))
  const streets = [...groups]
    .filter((area) => map.data?.places[area])
    .map((area) => {
      const a = map.data!.places[area]!
      return { area, at: [a.x, a.y] as [number, number], name: areaNames[area] ?? area }
    })

  const zoom = (factor: number, cx = size.w / 2, cy = size.h / 2) =>
    setView((cur) => {
      if (!cur) return cur
      const mpp = Math.max(0.15, Math.min(40, cur.mpp * factor))
      // Keep the point under the fingers where it is.
      const mx = cur.x + (cx - size.w / 2) * cur.mpp
      const my = cur.y - (cy - size.h / 2) * cur.mpp
      return { mpp, x: mx - (cx - size.w / 2) * mpp, y: my + (cy - size.h / 2) * mpp }
    })

  return (
    <Shell title={t('oal.world.mapTitle', { town })} onClose={onClose} onList={() => setShowList((s) => !s)} listing={showList}>
      {showList ? (
        list
      ) : (
        <div
          ref={box}
          className="relative h-full w-full touch-none overflow-hidden rounded-2xl bg-[#141a3a]"
          data-testid="oal-map-canvas"
          onWheel={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top)
          }}
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest('button')) return
            e.currentTarget.setPointerCapture(e.pointerId)
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
            if (pointers.current.size === 2) {
              const [a, b] = [...pointers.current.values()]
              pinch.current = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), mpp: v?.mpp ?? 1 }
            }
          }}
          onPointerMove={(e) => {
            const was = pointers.current.get(e.pointerId)
            if (!was) return
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
            if (pointers.current.size === 2 && pinch.current) {
              const [a, b] = [...pointers.current.values()]
              const d = Math.hypot(a!.x - b!.x, a!.y - b!.y)
              const mpp = pinch.current.mpp
              setView((cur) => (cur ? { ...cur, mpp: Math.max(0.15, Math.min(40, (mpp * pinch.current!.d) / Math.max(1, d))) } : cur))
            } else if (pointers.current.size === 1) {
              const dx = e.clientX - was.x
              const dy = e.clientY - was.y
              setView((cur) => (cur ? { ...cur, x: cur.x - dx * cur.mpp, y: cur.y + dy * cur.mpp } : cur))
            }
          }}
          onPointerUp={(e) => {
            pointers.current.delete(e.pointerId)
            if (pointers.current.size < 2) pinch.current = null
          }}
          onPointerCancel={(e) => pointers.current.delete(e.pointerId)}
        >
          {!map.data || !v ? (
            <Skeleton className="h-full rounded-none" />
          ) : (
            <>
              <svg className="absolute inset-0 h-full w-full" viewBox={`${v.x - (size.w / 2) * v.mpp} ${-v.y - (size.h / 2) * v.mpp} ${size.w * v.mpp} ${size.h * v.mpp}`} aria-hidden>
                {map.data.sea.length > 0 && <path d={path(map.data.sea, true)} fill="#0e3557" />}
                {map.data.wetland.map((w, i) => (
                  <path key={`w${i}`} d={path(w, true)} fill="#173e44" />
                ))}
                {map.data.water.map((w, i) => (
                  <path key={`l${i}`} d={path(w, true)} fill="#0e3557" />
                ))}
                {map.data.rivers.map((r, i) => (
                  <path key={`r${i}`} d={path(r.p)} fill="none" stroke="#0e3557" strokeWidth={r.w * 1.5} vectorEffect="non-scaling-stroke" />
                ))}
                {map.data.airfields.map((a, i) => (
                  <path key={`a${i}`} d={path(a, true)} fill="#232a52" />
                ))}
                {v.mpp < 2 && map.data.buildings.map((b, i) => <path key={`b${i}`} d={path(b, true)} fill="#2c3466" stroke="#3d468a" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
                {v.mpp < 6 &&
                  map.data.roads.minor.map((r, i) => <path key={`m${i}`} d={path(r.p)} fill="none" stroke="#3b4373" strokeWidth={v.mpp < 1.5 ? 3 : 1.2} vectorEffect="non-scaling-stroke" />)}
                {map.data.roads.middle.map((r, i) => (
                  <path key={`t${i}`} d={path(r.p)} fill="none" stroke="#9aa0c4" strokeWidth={v.mpp < 1.5 ? 4 : 2} vectorEffect="non-scaling-stroke" />
                ))}
                {map.data.roads.major.map((r, i) => (
                  <path key={`j${i}`} d={path(r.p)} fill="none" stroke="#e8b41c" strokeWidth={v.mpp < 1.5 ? 6 : 3} vectorEffect="non-scaling-stroke" />
                ))}
              </svg>
              {!near &&
                streets.map((s) => (
                  <button key={s.area} type="button" className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-edge bg-panel px-3 py-1 text-xs font-bold shadow" style={toScreen(...s.at)} onClick={() => setView((cur) => (cur ? { x: s.at[0], y: s.at[1], mpp: 0.6 } : cur))} data-testid={`oal-map-area-${s.area}`}>
                    {s.name}
                  </button>
                ))}
              {shown.map(({ mark, at }) => {
                let pos = toScreen(...at)
                // Somewhere off the map (the airport down the road): kept at the edge, with how far.
                const far = map.data!.far[mark.place]
                if (far) pos = { left: Math.max(36, Math.min(size.w - 90, pos.left)), top: Math.max(28, Math.min(size.h - 40, pos.top)) }
                else if (pos.left < -40 || pos.top < -40 || pos.left > size.w + 40 || pos.top > size.h + 40) return null
                return (
                  <button key={`${mark.area}-${mark.place}`} type="button" aria-label={mark.name} className={`absolute flex h-10 min-w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center gap-1 rounded-full border px-2 shadow ${chosen === mark ? 'border-edge bg-brand text-brand-ink' : 'border-line bg-panel text-fg'}`} style={pos} onClick={() => setChosen(mark)} data-testid={`oal-pin-${mark.area}-${mark.place}`}>
                    <Icon kind={mark.place} />
                    {far && <span className="text-xs font-bold">{t('oal.world.km', { km: far.km })}</span>}
                  </button>
                )
              })}
              {meAt && (
                <div className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2" style={toScreen(meAt.x, meAt.y)} data-testid="oal-map-me">
                  {/* The arrow points up unturned; the street's forward (sin, -cos) is (sin, cos) on screen. */}
                  <svg width="30" height="30" viewBox="-15 -15 30 30" style={{ transform: `rotate(${meAt.facing === null ? 0 : Math.PI - meAt.facing}rad)` }}>
                    <circle r="13" fill="#e8b41c" fillOpacity="0.25" />
                    <path d="M0 -10 L7 8 L0 4 L-7 8 Z" fill="#e8b41c" stroke="#141a3a" strokeWidth="1.5" />
                  </svg>
                </div>
              )}
              <div className="absolute bottom-3 right-3 flex flex-col gap-2">
                <button type="button" className="glass h-11 w-11 rounded-full border border-line text-xl font-bold" onClick={() => zoom(1 / 1.6)} aria-label={t('oal.world.zoomIn')}>
                  +
                </button>
                <button type="button" className="glass h-11 w-11 rounded-full border border-line text-xl font-bold" onClick={() => zoom(1.6)} aria-label={t('oal.world.zoomOut')}>
                  −
                </button>
              </div>
              <p className="pointer-events-none absolute bottom-1 left-2 text-[0.6rem] text-muted">© OpenStreetMap contributors</p>
            </>
          )}
          {chosen && (
            <div className="glass absolute inset-x-3 bottom-16 flex flex-col gap-2 rounded-2xl border border-line p-3" data-testid="oal-map-card">
              <p className="font-semibold">{chosen.name}</p>
              <div className="flex gap-2">
                <Button onClick={() => onGo(chosen, false)} data-testid="oal-map-go">
                  {t('oal.world.goHere')}
                </Button>
                {chosen.walk && (
                  <Button variant="ghost" onClick={() => onGo(chosen, true)} data-testid="oal-map-walk-here">
                    {t('oal.world.walkHere')}
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setChosen(null)}>
                  {t('oal.street.done')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Shell>
  )
}

function Shell({ title, onClose, onList, listing, children }: { title: string; onClose: () => void; onList: () => void; listing?: boolean; children: ReactNode }) {
  const { t } = useTranslation()
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col gap-2 bg-surface p-3" data-testid="oal-map-sheet">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-xl font-extrabold text-accent">{title}</h2>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onList} aria-pressed={listing} data-testid="oal-map-list">
            {listing ? t('oal.world.mapView') : t('oal.world.listView')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('oal.street.done')}
          </Button>
        </div>
      </div>
      <div className={`min-h-0 flex-1 ${listing ? 'overflow-y-auto' : ''}`}>{children}</div>
    </div>,
    document.body,
  )
}

/** A place's mark: the hub's line drawing for what it is. */
function Icon({ kind }: { kind: string }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  const d: Record<string, ReactNode> = {
    home: <path d="M4 11 12 4l8 7M6 10v9h12v-9M10 19v-5h4v5" {...p} />,
    cookshop: <path d="M5 11h14a7 7 0 0 1-14 0ZM8 7c0-1 1-1 1-2M12 7c0-1 1-1 1-2M16 7c0-1 1-1 1-2" {...p} />,
    phone: <path d="M8 3h8v18H8zM11 18h2" {...p} />,
    changer: <path d="M4 7h16v10H4zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5M7 12h.01M17 12h.01" {...p} />,
    kekeh: <path d="M5 16h14l-2-7H9l-2 4H5zM8 16a2 2 0 1 0 0 .1M17 16a2 2 0 1 0 0 .1M9 9V6h6" {...p} />,
    clinic: <path d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z" {...p} />,
    stall: <path d="M4 9 6 4h12l2 5M4 9h16M5 9v10M19 9v10M5 14h14" {...p} />,
    jobs: <path d="M4 8h16v11H4zM9 8V5h6v3M4 13h16" {...p} />,
    visa: <path d="M6 3h12v18H6zM12 8a3 3 0 1 0 0 6 3 3 0 0 0 0-6M9 17h6" {...p} />,
    health: <path d="M3 20h18M5 20V9h14v11M3 9l9-5 9 5M11 11h2v2h2v2h-2v2h-2v-2H9v-2h2z" {...p} />,
    starline: <path d="M7 3h10v18H7zM10 7h4v5h-4zM12 12v3" {...p} />,
    citrus: <path d="M7 3h10v18H7zM10 7h4v5h-4zM12 12v3" {...p} />,
    airport: <path d="M12 3v7l8 4v2l-8-2v4l3 2v1l-3-1-3 1v-1l3-2v-4l-8 2v-2l8-4V3" {...p} />,
    town: <path d="M4 20V9l5-3v14M9 20V4l7 3v13M16 20v-9l4 2v7M3 20h18" {...p} />,
  }
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      {d[kind] ?? d.town}
    </svg>
  )
}
