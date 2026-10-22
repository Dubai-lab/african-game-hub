// One Africa Life: the player's home arranged as they want it. In the family's house, "Arrange
// your home" lists their things (bought at Furniture City) and the house's own furniture: a thing
// kept aside is put in front of them; one in the house is moved (a step at a time, as they see it:
// forward, back, left, right; a quarter turn), put aside or sold (half its price, at once); the
// house's own living room and bedroom furniture sold too. Only where it fits (in the house's
// rooms, clear of its walls and the other things) is it put; the server keeps where.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/core/auth/AuthContext'
import { callFunction, refusalMessage } from '@/core/lib/functions'
import { supabase } from '@/core/lib/supabase'
import { Button } from '@/core/ui/Button'
import { toast } from '@/core/ui/toast'
import { ITEMS } from '../../../supabase/functions/_shared/oalItems'
import { changed, fits, footprintOf, homeStore, type Thing } from './city/HomeThings'

const PIECES = { living: 12000, bedroom: 8000 } as const
const STEP = 0.25
/** To the nearest quarter turn, within one turn either way of straight (-pi .. pi). */
const snap = (a: number) => {
  const q = Math.round(a / (Math.PI / 2)) * (Math.PI / 2)
  return Math.atan2(Math.sin(q), Math.cos(q))
}

export function HomeDesign() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [inside, setInside] = useState(homeStore.inside)
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<number | null>(null)
  const [moving, setMoving] = useState(false)
  const [busy, setBusy] = useState(false)
  const things = useQuery({
    queryKey: ['oal-things', user?.id],
    enabled: Boolean(user),
    // (Quiet when it cannot be fetched: the house is simply as it was.)
    meta: { silent: true },
    queryFn: async () => {
      const [a, b] = await Promise.all([
        supabase.from('oal_things').select('id, item, placed, x, y, rot, paid, bought_at, arrives_at').order('id'),
        supabase.from('oal_pieces_sold').select('piece'),
      ])
      if (a.error) throw a.error
      if (b.error) throw b.error
      return { things: a.data as Thing[], sold: (b.data as { piece: string }[]).map((r) => r.piece) }
    },
  })
  // The scene draws what the server keeps.
  useEffect(() => {
    if (!things.data) return
    homeStore.things = things.data.things
    homeStore.sold = new Set(things.data.sold)
    changed()
  }, [things.data])
  useEffect(() => {
    homeStore.onInside = setInside
    homeStore.onDelivered = () => void queryClient.invalidateQueries({ queryKey: ['oal-things'] })
    return () => {
      homeStore.onInside = undefined
      homeStore.onDelivered = undefined
    }
  }, [queryClient])
  useEffect(() => {
    if (!inside) {
      setOpen(false)
      stopMoving()
    }
  }, [inside]) // eslint-disable-line react-hooks/exhaustive-deps

  const thing = things.data?.things.find((x) => x.id === chosen) ?? null
  const act = async (body: Record<string, unknown>, ok?: string) => {
    setBusy(true)
    try {
      const reply = await callFunction('oal-home', body)
      if (!reply.ok) {
        toast.error(refusalMessage(reply.code))
        return false
      }
      if (ok) toast.success(ok)
      await queryClient.invalidateQueries({ queryKey: ['oal-things'] })
      await queryClient.invalidateQueries({ queryKey: ['oal-money'] })
      return true
    } catch {
      toast.error(t('errors.network'))
      return false
    } finally {
      setBusy(false)
    }
  }
  const stopMoving = () => {
    homeStore.moving = null
    setMoving(false)
    changed()
  }
  // In front of the player, facing them.
  const putHere = (x: Thing) => {
    const f = homeStore.facing
    const [, depth] = ITEMS_SIZE(x)
    const reach = 0.9 + depth / 2
    const [u, v] = homeStore.at
    homeStore.moving = { id: x.id, x: u + Math.sin(f) * reach, y: v - Math.cos(f) * reach, rot: snap(f + Math.PI) }
    setMoving(true)
    changed()
  }
  const startMoving = (x: Thing) => {
    homeStore.moving = { id: x.id, x: x.x ?? 0, y: x.y ?? 0, rot: x.rot ?? 0 }
    setMoving(true)
    changed()
  }
  // A step as the player sees it (forward: the way they face; right: to their right).
  const step = (ahead: number, right: number) => {
    const m = homeStore.moving
    if (!m) return
    const f = homeStore.facing
    m.x += (Math.sin(f) * ahead - Math.cos(f) * right) * STEP
    m.y += (-Math.cos(f) * ahead - Math.sin(f) * right) * STEP
    changed()
  }
  const turn = () => {
    const m = homeStore.moving
    if (!m) return
    m.rot = snap(m.rot + Math.PI / 2)
    changed()
  }
  const done = async () => {
    const m = homeStore.moving
    if (!m || !thing) return
    if (!fits(thing.id, thing.item, m.x, m.y, m.rot)) {
      toast.error(t('oal.home.design.noRoom'))
      return
    }
    if (await act({ action: 'place_thing', id: thing.id, x: m.x, y: m.y, rot: m.rot })) stopMoving()
  }

  if (!inside) return null
  return (
    <>
      {!open && (
        <div className="absolute right-4 top-56 landscape:right-3 landscape:top-[4.25rem]">
          <Button variant="ghost" className="min-h-12 px-5" onClick={() => setOpen(true)} data-testid="oal-arrange">
            {t('oal.home.design.open')}
          </Button>
        </div>
      )}
      {open && (
        <div data-panel className="glass absolute inset-x-0 bottom-0 z-10 mx-auto flex max-h-[62vh] max-w-lg flex-col gap-2 overflow-y-auto rounded-t-3xl border border-line p-3 landscape:inset-x-auto landscape:right-0 landscape:top-[4.5rem] landscape:bottom-0 landscape:mx-0 landscape:w-[min(26rem,55vw)] landscape:max-h-none landscape:rounded-t-none landscape:rounded-tl-3xl" data-testid="oal-arrange-panel">
          {!thing ? (
            <>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">{t('oal.home.design.title')}</h2>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  {t('oal.street.done')}
                </Button>
              </div>
              {(things.data?.things ?? []).length === 0 && <p className="text-sm text-muted">{t('oal.home.design.none')}</p>}
              {(things.data?.things ?? []).map((x) => (
                <button key={x.id} type="button" className="flex items-center justify-between rounded-2xl border border-line bg-panel px-3 py-2 text-left" onClick={() => setChosen(x.id)} data-testid={`oal-thing-${x.item}`}>
                  <span className="font-semibold">{ITEMS[x.item].name}</span>
                  <span className="text-xs text-muted">{onItsWay(x) ? t('oal.home.design.onItsWay') : x.placed ? t('oal.home.design.inHouse') : t('oal.home.design.aside')}</span>
                </button>
              ))}
              <h3 className="mt-2 text-sm font-bold text-muted">{t('oal.home.design.ownTitle')}</h3>
              {(Object.keys(PIECES) as (keyof typeof PIECES)[]).map((piece) =>
                things.data?.sold.includes(piece) ? null : (
                  <div key={piece} className="flex items-center justify-between gap-2 rounded-2xl border border-line bg-panel px-3 py-2">
                    <span className="text-sm font-semibold">{t(`oal.home.design.pieces.${piece}`)}</span>
                    <Button
                      variant="ghost"
                      className="min-h-10 px-3 text-sm"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(t('oal.home.design.sellPieceConfirm', { got: PIECES[piece] / 100 }))) void act({ action: 'sell_piece', piece }, t('oal.home.design.sold', { got: PIECES[piece] / 100 }))
                      }}
                      data-testid={`oal-sell-piece-${piece}`}
                    >
                      {t('oal.home.design.sellFor', { got: PIECES[piece] / 100 })}
                    </Button>
                  </div>
                ),
              )}
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">{ITEMS[thing.item].name}</h2>
                <Button
                  variant="ghost"
                  onClick={() => {
                    stopMoving()
                    setChosen(null)
                  }}
                >
                  {t('oal.home.design.back')}
                </Button>
              </div>
              {moving ? (
                <>
                  <p className="text-sm text-muted">{t('oal.home.design.moveHint')}</p>
                  <div className="grid grid-cols-3 gap-2">
                    <span />
                    <Button variant="ghost" className="min-h-12" onClick={() => step(1, 0)} data-testid="oal-move-ahead" aria-label={t('oal.home.design.away')}>
                      ↑
                    </Button>
                    <span />
                    <Button variant="ghost" className="min-h-12" onClick={() => step(0, -1)} aria-label={t('oal.home.design.left')}>
                      ←
                    </Button>
                    <Button variant="ghost" className="min-h-12" onClick={turn} data-testid="oal-move-turn">
                      {t('oal.home.design.turn')}
                    </Button>
                    <Button variant="ghost" className="min-h-12" onClick={() => step(0, 1)} aria-label={t('oal.home.design.right')}>
                      →
                    </Button>
                    <span />
                    <Button variant="ghost" className="min-h-12" onClick={() => step(-1, 0)} aria-label={t('oal.home.design.toward')}>
                      ↓
                    </Button>
                    <span />
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" className="min-h-12 flex-1" onClick={stopMoving}>
                      {t('oal.home.design.cancel')}
                    </Button>
                    <Button className="min-h-12 flex-1" disabled={busy} onClick={() => void done()} data-testid="oal-move-done">
                      {t('oal.home.design.done')}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex flex-col gap-2">
                  {onItsWay(thing) ? (
                    <p className="text-sm text-muted" data-testid="oal-thing-on-its-way">{t('oal.home.design.onItsWayHint')}</p>
                  ) : thing.placed ? (
                    <>
                      <Button className="min-h-12" onClick={() => startMoving(thing)} data-testid="oal-thing-move">
                        {t('oal.home.design.move')}
                      </Button>
                      <Button variant="ghost" className="min-h-12" disabled={busy} onClick={() => void act({ action: 'store_thing', id: thing.id })} data-testid="oal-thing-aside">
                        {t('oal.home.design.putAside')}
                      </Button>
                    </>
                  ) : (
                    <Button className="min-h-12" onClick={() => putHere(thing)} data-testid="oal-thing-here">
                      {t('oal.home.design.putHere')}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    className="min-h-12"
                    disabled={busy}
                    onClick={async () => {
                      if (!window.confirm(t('oal.home.design.sellConfirm', { name: ITEMS[thing.item].name, got: thing.paid / 200 }))) return
                      if (await act({ action: 'sell_thing', id: thing.id }, t('oal.home.design.sold', { got: thing.paid / 200 }))) setChosen(null)
                    }}
                    data-testid="oal-thing-sell"
                  >
                    {t('oal.home.design.sellFor', { got: thing.paid / 200 })}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  )
}

/** Bought, still on Furniture City's truck. */
const onItsWay = (x: Thing) => Boolean(x.arrives_at && Date.parse(x.arrives_at) > Date.now())

/** A thing's width and depth as it stands unturned. */
function ITEMS_SIZE(x: Thing): [number, number] {
  const [x0, y0, x1, y1] = footprintOf(x.item, 0, 0, 0)
  return [x1 - x0, y1 - y0]
}
