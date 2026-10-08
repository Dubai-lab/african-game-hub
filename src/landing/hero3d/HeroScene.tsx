// The 3D hero. Loaded lazily, only on the landing page, only on devices that can afford it.
// Deep import: the drei index would pull the whole library into this chunk.
import { PerformanceMonitor } from '@react-three/drei/core/PerformanceMonitor'
import { Canvas, type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react'
import {
  CanvasTexture,
  CircleGeometry,
  type Group,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Mesh,
  SRGBColorSpace,
  Vector3,
} from 'three'
import { COLORS, MOVE, POSITION, type PieceKind, pieceGeometry, type Side, squareToXZ } from './pieces'

/** Shared with the wrapper so scroll and pointer never cause React re-renders. */
export type HeroControls = {
  scroll: number
  pointerX: number
  pointerY: number
  /** Set by the scene: asks for one more frame. */
  wake: () => void
}

type Props = {
  controls: RefObject<HeroControls>
  visible: boolean
  mobile: boolean
  /** Skip the intro and show the final position at once (used to render the still picture). */
  instant?: boolean
  onReady: () => void
  onMoved: () => void
}

const BOARD_SIZE = 9.2
const RIM = (BOARD_SIZE - 8) / 2

// Board top: the squares plus a maize rim carrying the zigzag of the band motif.
function makeBoardTexture(): CanvasTexture {
  const size = 1024
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const rim = (RIM / BOARD_SIZE) * size
  const square = (size - rim * 2) / 8

  ctx.fillStyle = COLORS.maize
  ctx.fillRect(0, 0, size, size)

  // Zigzag teeth pointing outward along all four edges.
  ctx.fillStyle = COLORS.indigo
  const teeth = 16
  const step = (size - rim * 2) / teeth
  const depth = rim * 0.62
  for (let i = 0; i < teeth; i++) {
    const a = rim + i * step
    const mid = a + step / 2
    const b = a + step
    const edges: [number, number][][] = [
      [[a, rim], [mid, rim - depth], [b, rim]],
      [[a, size - rim], [mid, size - rim + depth], [b, size - rim]],
      [[rim, a], [rim - depth, mid], [rim, b]],
      [[size - rim, a], [size - rim + depth, mid], [size - rim, b]],
    ]
    for (const [p0, p1, p2] of edges) {
      ctx.beginPath()
      ctx.moveTo(p0![0], p0![1])
      ctx.lineTo(p1![0], p1![1])
      ctx.lineTo(p2![0], p2![1])
      ctx.fill()
    }
  }

  ctx.fillStyle = COLORS.hibiscus
  ctx.fillRect(rim - 6, rim - 6, size - rim * 2 + 12, size - rim * 2 + 12)

  // Canvas row 0 is the far side of the board (rank 8). a1 is a dark square.
  for (let row = 0; row < 8; row++) {
    for (let file = 0; file < 8; file++) {
      const rank = 7 - row
      ctx.fillStyle = (file + rank) % 2 === 0 ? COLORS.indigoSoft : COLORS.limewash
      ctx.fillRect(rim + file * square, rim + row * square, square + 0.5, square + 0.5)
    }
  }

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const easeOut = (p: number) => 1 - (1 - p) ** 3
const easeInOut = (p: number) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2)

const INTRO_SECONDS = 2.4
const MOVE_START = 0.9
const MOVE_SECONDS = 0.9
const HOP_SECONDS = 0.45

function Board() {
  const texture = useMemo(makeBoardTexture, [])
  const materials = useMemo(() => {
    const side = new MeshStandardMaterial({ color: COLORS.ink, roughness: 0.7 })
    const top = new MeshStandardMaterial({ map: texture, roughness: 0.62 })
    // Box faces: +x, -x, +y (the top), -y, +z, -z.
    return [side, side, top, side, side, side]
  }, [texture])

  useEffect(
    () => () => {
      texture.dispose()
      materials[0]!.dispose()
      materials[2]!.dispose()
    },
    [texture, materials],
  )

  return (
    <mesh position={[0, -0.2, 0]} material={materials}>
      <boxGeometry args={[BOARD_SIZE, 0.4, BOARD_SIZE]} />
    </mesh>
  )
}

function Pieces({ controls, instant, onMoved }: Omit<Props, 'visible' | 'onReady' | 'mobile'>) {
  const board = useRef<Group>(null)
  const bodies = useRef(new Map<string, Mesh>())
  const mover = useRef<Group>(null)
  const hops = useRef(new Map<string, number>())
  const startedAt = useRef<number | null>(null)
  const lastFrame = useRef(0)
  const moved = useRef(false)
  const invalidate = useThree((s) => s.invalidate)

  const material = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.36 }), [])
  const shadowMaterial = useMemo(
    () => new MeshBasicMaterial({ color: '#05082a', transparent: true, opacity: 0.22, depthWrite: false }),
    [],
  )
  const shadowGeometry = useMemo(() => new CircleGeometry(0.4, 20), [])
  useEffect(
    () => () => {
      material.dispose()
      shadowMaterial.dispose()
      shadowGeometry.dispose()
    },
    [material, shadowMaterial, shadowGeometry],
  )

  useEffect(() => {
    controls.current.wake = invalidate
  }, [controls, invalidate])

  const pieces = useMemo(
    () =>
      POSITION.map((code) => {
        const side = code[0] as Side
        const kind = code[1] as PieceKind
        const square = code.slice(2)
        const [x, z] = squareToXZ(square)
        return { side, kind, square, x, z }
      }),
    [],
  )

  const from = useMemo(() => new Vector3(squareToXZ(MOVE.from)[0], 0, squareToXZ(MOVE.from)[1]), [])
  const to = useMemo(() => new Vector3(squareToXZ(MOVE.to)[0], 0, squareToXZ(MOVE.to)[1]), [])

  // Camera poses. The frame is 4:3 on every screen, so one set of poses fits phones and desktops,
  // and the still picture (rendered at `rest`) lines up exactly with the live scene.
  const poses = useMemo(
    () => ({
      start: new Vector3(-6.8, 4.6, 16),
      rest: new Vector3(-4.6, 8.6, 13.6),
      lifted: new Vector3(-0.6, 19.5, 6.4),
      target: new Vector3(0.1, 0, 0.5),
    }),
    [],
  )
  const desired = useMemo(() => new Vector3(), [])

  useFrame(({ camera }) => {
    const now = performance.now()
    if (startedAt.current === null) {
      startedAt.current = instant ? now - 60_000 : now
      camera.position.copy(instant ? poses.rest : poses.start)
      lastFrame.current = now
    }
    const t = (now - startedAt.current) / 1000
    const dt = Math.min(0.05, (now - lastFrame.current) / 1000)
    lastFrame.current = now
    let active = t < INTRO_SECONDS + 0.4

    // Camera: glide in, then follow the scroll position upward.
    desired.lerpVectors(poses.start, poses.rest, easeOut(clamp01(t / INTRO_SECONDS)))
    desired.lerp(poses.lifted, easeInOut(clamp01(controls.current.scroll)))
    const damping = instant ? 1 : 1 - Math.exp(-dt * 9)
    camera.position.lerp(desired, damping)
    camera.lookAt(poses.target)
    if (camera.position.distanceToSquared(desired) > 1e-5) active = true

    // The board leans a little toward the pointer.
    if (board.current) {
      const leanY = controls.current.pointerX * 0.13
      const leanX = controls.current.pointerY * 0.035
      board.current.rotation.y += (leanY - board.current.rotation.y) * damping
      board.current.rotation.x += (leanX - board.current.rotation.x) * damping
      if (Math.abs(leanY - board.current.rotation.y) > 1e-3) active = true
    }

    // The one move: the opponent's knight lifts, arcs across and lands.
    const body = bodies.current.get(MOVE.from)
    if (mover.current && body) {
      const p = clamp01((t - MOVE_START) / MOVE_SECONDS)
      mover.current.position.lerpVectors(from, to, easeInOut(p))
      const settle = clamp01((t - MOVE_START - MOVE_SECONDS) / 0.25)
      body.position.y = Math.sin(Math.PI * p) * 0.85
      body.scale.y = 1 - 0.12 * Math.sin(Math.PI * settle)
      if (p >= 1 && !moved.current) {
        moved.current = true
        onMoved()
      }
    }

    // Pieces the visitor tapped hop once.
    for (const [square, began] of hops.current) {
      const mesh = bodies.current.get(square)
      const p = clamp01((now - began) / 1000 / HOP_SECONDS)
      if (mesh && square !== MOVE.from) mesh.position.y = Math.sin(Math.PI * p) * 0.4
      if (p >= 1) hops.current.delete(square)
      else active = true
    }

    if (active) invalidate()
  })

  const hop = (square: string) => (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    if (!hops.current.has(square)) hops.current.set(square, performance.now())
    invalidate()
  }

  return (
    <group ref={board}>
      <Board />
      {pieces.map(({ side, kind, square, x, z }) => (
        <group key={square} ref={square === MOVE.from ? mover : undefined} position={[x, 0, z]}>
          <mesh
            ref={(mesh) => {
              if (mesh) bodies.current.set(square, mesh)
              else bodies.current.delete(square)
            }}
            geometry={pieceGeometry(kind, side)}
            material={material}
            // Knights are turned a little so their wedge shows in profile, as players often set them.
            rotation={[0, (side === 'b' ? Math.PI : 0) + (kind === 'n' ? -1.05 : 0), 0]}
            onPointerDown={hop(square)}
          />
          <mesh geometry={shadowGeometry} material={shadowMaterial} rotation={[-Math.PI / 2, 0, 0]} position={[0.06, 0.004, 0.05]} />
        </group>
      ))}
    </group>
  )
}

function ReadySignal({ onReady, instant }: { onReady: () => void; instant?: boolean }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    // Two frames: one to draw, one so the drawn frame is on screen before the picture fades.
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(onReady)
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [onReady])

  useEffect(() => {
    if (!import.meta.env.DEV || !instant) return
    // Development only: lets scripts/captureHero.ts save the still picture of this exact scene.
    const w = window as unknown as { __heroCapture?: () => string }
    w.__heroCapture = () => {
      gl.render(scene, camera)
      // Quality chosen by eye: flat colours and hard edges compress well.
      return gl.domElement.toDataURL('image/webp', 0.72)
    }
    return () => {
      delete w.__heroCapture
    }
  }, [gl, scene, camera, instant])
  return null
}

export default function HeroScene({ controls, visible, mobile, instant, onReady, onMoved }: Props) {
  // Budget phones: never render above 1.5x, and drop to 1x if frames are slow.
  const [dpr, setDpr] = useState(mobile ? 1.5 : 2)

  return (
    <Canvas
      // Draw only when something changes; stop entirely while the hero is off screen.
      flat
      frameloop={visible ? 'demand' : 'never'}
      dpr={[1, dpr]}
      camera={{ fov: 34, near: 0.5, far: 60 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'default', preserveDrawingBuffer: Boolean(instant) }}
      style={{ touchAction: 'pan-y' }}
      aria-hidden="true"
    >
      <PerformanceMonitor onDecline={() => setDpr(1)} />
      <hemisphereLight args={['#ffffff', '#8f9be6', 1.7]} />
      <directionalLight position={[-5, 9, 6]} intensity={1.5} />
      <directionalLight position={[6, 5, -7]} intensity={1.6} color="#ffe9a8" />
      <Pieces controls={controls} instant={instant} onMoved={onMoved} />
      <ReadySignal onReady={onReady} instant={instant} />
    </Canvas>
  )
}
