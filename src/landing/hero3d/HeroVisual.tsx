import { Component, type ComponentType, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { shouldRun3D } from './capability'
import type { HeroControls } from './HeroScene'

type SceneComponent = ComponentType<{
  controls: React.RefObject<HeroControls>
  visible: boolean
  mobile: boolean
  instant?: boolean
  onReady: () => void
  onMoved: () => void
}>

/** If WebGL fails for any reason, show nothing extra: the still picture underneath remains. */
class SceneBoundary extends Component<{ children: ReactNode; onFail: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    this.props.onFail()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

const YOUR_START_SECONDS = 5 * 60
// The clock is decoration: it ticks for a short while to show the game is live, then rests.
const TICK_FOR_SECONDS = 20

function formatClock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function Clocks({ running }: { running: boolean }) {
  const { t } = useTranslation()
  const [left, setLeft] = useState(YOUR_START_SECONDS)

  useEffect(() => {
    if (!running || left <= YOUR_START_SECONDS - TICK_FOR_SECONDS) return
    const id = setTimeout(() => setLeft((s) => s - 1), 1000)
    return () => clearTimeout(id)
  }, [running, left])

  const chip = 'flex items-center gap-2 rounded-md px-2.5 py-1 text-sm font-bold tabular-nums'
  return (
    <div aria-hidden="true" className="pointer-events-none absolute left-5 right-5 top-2 flex justify-between lg:left-6 lg:right-36">
      <span className={`${chip} bg-ink/55 text-surface`}>
        {t('landing.hero.opponent')} <span>4:52</span>
      </span>
      <span className={`${chip} bg-brand text-brand-ink`}>
        {t('landing.hero.you')} <span>{formatClock(left)}</span>
      </span>
    </div>
  )
}

/**
 * The hero's picture. Everyone first sees a still render of the scene, which is ordinary HTML
 * and costs about 40 KB. Capable devices then load the live 3D scene on top once the page is
 * idle, and it fades in over the picture so nothing shifts.
 */
export function HeroVisual() {
  const { t } = useTranslation()
  const frame = useRef<HTMLDivElement>(null)
  const controls = useRef<HeroControls>({ scroll: 0, pointerX: 0, pointerY: 0, wake: () => {} })
  const [Scene, setScene] = useState<SceneComponent | null>(null)
  const [live, setLive] = useState(false)
  const [visible, setVisible] = useState(true)
  const [moved, setMoved] = useState(false)
  const [mobile, setMobile] = useState(true)
  const [instant, setInstant] = useState(false)

  // Decide after first paint, and load the 3D code only when the browser is idle.
  useEffect(() => {
    if (!shouldRun3D()) return
    setMobile(window.matchMedia('(max-width: 1023px)').matches)
    setInstant(import.meta.env.DEV && new URLSearchParams(window.location.search).has('capture'))
    let cancelled = false
    const load = () => {
      import('./HeroScene')
        .then((module) => {
          if (!cancelled) setScene(() => module.default)
        })
        .catch(() => {
          // Offline or a failed download: the still picture stays.
        })
    }
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(load, { timeout: 2500 })
      return () => {
        cancelled = true
        window.cancelIdleCallback(id)
      }
    }
    const id = setTimeout(load, 1200)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [])

  // Stop drawing when the hero is off screen; follow the scroll while it is on screen.
  useEffect(() => {
    const el = frame.current
    if (!el || !Scene) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? true), { threshold: 0.02 })
    observer.observe(el)
    const onScroll = () => {
      const travel = el.offsetTop + el.offsetHeight
      controls.current.scroll = travel > 0 ? Math.min(1, Math.max(0, window.scrollY / travel)) : 0
      controls.current.wake()
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', onScroll)
    }
  }, [Scene])

  const onReady = useCallback(() => setLive(true), [])
  const onMoved = useCallback(() => setMoved(true), [])
  const onFail = useCallback(() => {
    setScene(null)
    setLive(false)
  }, [])

  return (
    <div
      ref={frame}
      className="relative aspect-[4/3] w-full select-none"
      onPointerMove={(event) => {
        const box = event.currentTarget.getBoundingClientRect()
        controls.current.pointerX = ((event.clientX - box.left) / box.width) * 2 - 1
        controls.current.pointerY = ((event.clientY - box.top) / box.height) * 2 - 1
        controls.current.wake()
      }}
      onPointerLeave={() => {
        controls.current.pointerX = 0
        controls.current.pointerY = 0
        controls.current.wake()
      }}
    >
      <img
        src="/landing/hero-poster.webp"
        alt={t('landing.hero.posterAlt')}
        width={1200}
        height={900}
        decoding="async"
        fetchPriority="high"
        className={`absolute inset-0 size-full object-contain transition-opacity duration-500 motion-reduce:transition-none ${live ? 'opacity-0' : 'opacity-100'}`}
      />
      {Scene && (
        <div className={`absolute inset-0 transition-opacity duration-500 ${live ? 'opacity-100' : 'opacity-0'}`}>
          <SceneBoundary onFail={onFail}>
            <Scene controls={controls} visible={visible} mobile={mobile} instant={instant} onReady={onReady} onMoved={onMoved} />
          </SceneBoundary>
        </div>
      )}
      {/* The clock only ticks alongside the live scene; with the still picture everything stays still. */}
      <Clocks running={visible && live && moved} />
    </div>
  )
}
