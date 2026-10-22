// One Africa Life: a thing on display at Furniture City, looked at close (in 3D, turned by a drag)
// and bought (paid in US dollars from the life's money; the server charges it): it is then the
// player's, at the family's house, waiting to be put somewhere (./HomeThings.tsx).
import { useQueryClient } from '@tanstack/react-query'
import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { type RefObject, Suspense, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Box3, type Group, Vector3 } from 'three'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { callFunction, refusalMessage } from '@/core/lib/functions'
import { Button } from '@/core/ui/Button'
import { toast } from '@/core/ui/toast'
import { ITEMS, type ItemId } from '../../../../supabase/functions/_shared/oalItems'
import { ITEMS_URL } from './FurnitureCity'

function Thing({ item, turn }: { item: ItemId; turn: RefObject<number> }) {
  const gltf = useLoader(GLTFLoader, ITEMS_URL, (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const ref = useRef<Group>(null)
  const thing = useMemo(() => {
    const t = gltf.scene.getObjectByName(`item_${item}`)!.clone(true)
    t.position.set(0, 0, 0)
    // Its size made to fill the view, whatever it is (a basin, a living room set).
    const size = new Box3().setFromObject(t).getSize(new Vector3())
    t.scale.setScalar(1.6 / Math.max(size.x, size.y, size.z))
    t.position.y = -0.45
    return t
  }, [gltf, item])
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y = turn.current ?? 0
    if (turn.current !== null && !dragging.on) (turn as { current: number }).current += dt * 0.35
  })
  return (
    <group ref={ref}>
      <primitive object={thing} />
    </group>
  )
}
const dragging = { on: false }

export function ItemPanel({ item, onClose }: { item: ItemId; onClose: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const turn = useRef(0.6)
  const from = useRef<{ x: number; turn: number } | null>(null)
  const it = ITEMS[item]
  const buy = async () => {
    setBusy(true)
    try {
      const reply = await callFunction('oal-home', { action: 'buy_thing', item })
      if (!reply.ok) {
        toast.error(refusalMessage(reply.code))
        return
      }
      toast.success(t('oal.store.bought', { name: it.name }))
      await queryClient.invalidateQueries({ queryKey: ['oal-money'] })
      await queryClient.invalidateQueries({ queryKey: ['oal-things'] })
      onClose()
    } catch {
      toast.error(t('errors.network'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div data-panel className="glass absolute inset-x-0 bottom-0 z-10 mx-auto flex max-h-[80vh] max-w-lg flex-col gap-3 rounded-t-3xl border border-line p-4 landscape:overflow-y-auto landscape:inset-x-auto landscape:right-0 landscape:top-[4.5rem] landscape:bottom-0 landscape:mx-0 landscape:w-[min(26rem,55vw)] landscape:max-h-none landscape:rounded-t-none landscape:rounded-tl-3xl" data-testid="oal-item-panel">
      <div
        className="h-56 shrink-0 touch-none landscape:h-40 overflow-hidden rounded-2xl border border-line bg-panel"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          from.current = { x: e.clientX, turn: turn.current }
          dragging.on = true
        }}
        onPointerMove={(e) => {
          if (from.current) turn.current = from.current.turn + (e.clientX - from.current.x) * 0.012
        }}
        onPointerUp={() => {
          from.current = null
          dragging.on = false
        }}
      >
        <Canvas camera={{ position: [0, 0.55, 2.4], fov: 40 }} dpr={[1, 2]}>
          <ambientLight intensity={0.9} />
          <directionalLight position={[2, 3, 2]} intensity={2.2} />
          <directionalLight position={[-2, 1.5, -1]} intensity={0.8} />
          <Suspense fallback={null}>
            <Thing item={item} turn={turn} />
          </Suspense>
        </Canvas>
      </div>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-bold">{it.name}</h2>
        <p className="shrink-0 text-xl font-extrabold text-accent" data-testid="oal-item-price">
          US$ {it.price.toLocaleString()}
        </p>
      </div>
      <p className="text-sm text-muted">{t('oal.store.delivery')}</p>
      <div className="flex gap-2">
        <Button variant="ghost" className="min-h-12 flex-1" onClick={onClose}>
          {t('oal.store.close')}
        </Button>
        <Button className="min-h-12 flex-1" disabled={busy} onClick={() => void buy()} data-testid="oal-item-buy">
          {t('oal.store.buy')}
        </Button>
      </div>
    </div>
  )
}
