// The court in 3D: a street court at dusk, the basket, the ball and the players. It draws the
// game it is given, sixty times a second, without asking React to draw anything again; it
// decides nothing about the game.
//
// The players are stand-ins made of simple shapes, moved by hand (legs that run, an arm that
// dribbles, both arms up to shoot). They are replaced by the owner's own characters, made in
// Blender and animated with Mixamo, when those are ready: one model per player, same places.
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { Component, type ReactNode, type RefObject, Suspense, useMemo, useRef } from 'react'
import { CanvasTexture, DoubleSide, type Group, type Mesh, type MeshStandardMaterial, type Object3D, PMREMGenerator, RepeatWrapping, SRGBColorSpace, Vector3 } from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { useSettingsStore } from '@/core/settings/settingsStore'
import { ARC, BALL_R, BOARD, COURT, type Game, RIM } from '../../../supabase/functions/_shared/basketball'
import { Athletes } from './Athletes'
import { PITCH, type View } from './camera'
import { dyeClothes } from './clothes'
import { bounceSound } from './sound'

export type World = {
  game: Game
  human: number
  /** When each player last reached for the ball (performance.now()), to draw the reach. */
  marks: Record<number, number>
  /** Each character's right hand, once loaded, to draw the ball in it. */
  hands: Record<number, Object3D>
  /** Where the player has turned the camera: see Follow and Controls. */
  view: View
  /** Each character's dribble, while dribbling: how far through the stroke, and the palm (see Athletes). */
  dribble: Record<number, { phase: number; palm: Vector3 }>
}


const PALETTE = { indigo: '#1f2a7a', indigoSoft: '#4455c7', maize: '#f5b700', hibiscus: '#d1264f', palm: '#0b7a55', white: '#f4f5ff' }
const TEAM_COLOURS = [
  { jersey: PALETTE.indigoSoft, trim: PALETTE.maize, shorts: '#1b2366' },
  { jersey: PALETTE.hibiscus, trim: PALETTE.white, shorts: '#6e1229' },
]
const SKIN = ['#7b4a2a', '#5c3a21', '#8d5524', '#a8693b']

// ---- The court's paint ----------------------------------------------------------------------

/** The painted court: asphalt, the key in indigo, the lines in white, and the hub's zigzag. */
function courtTexture(): CanvasTexture {
  const scale = 64 // pixels a metre
  const w = (COURT.halfWidth * 2 + 2) * scale
  const h = (COURT.depth + 2) * scale
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  // Court x runs -8.5..8.5, z runs -1..12 across the picture.
  const X = (x: number) => (x + COURT.halfWidth + 1) * scale
  const Z = (z: number) => (z + 1) * scale

  ctx.fillStyle = '#2a3142'
  ctx.fillRect(0, 0, w, h)
  // A little grit in the asphalt.
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`
    ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2)
  }
  // The playing surface, a shade warmer.
  ctx.fillStyle = '#323b55'
  ctx.fillRect(X(-COURT.halfWidth), Z(0), COURT.halfWidth * 2 * scale, COURT.depth * scale)
  // Beyond the arc, a deeper blue.
  ctx.save()
  ctx.beginPath()
  ctx.rect(X(-COURT.halfWidth), Z(0), COURT.halfWidth * 2 * scale, COURT.depth * scale)
  ctx.arc(X(RIM.x), Z(RIM.z), ARC * scale, 0, Math.PI, false)
  ctx.closePath()
  ctx.fillStyle = 'rgba(31,42,122,0.55)'
  ctx.fill('evenodd')
  ctx.restore()
  // The key.
  ctx.fillStyle = PALETTE.indigo
  ctx.fillRect(X(-2.45), Z(0), 4.9 * scale, 5.8 * scale)

  ctx.strokeStyle = PALETTE.white
  ctx.lineWidth = 0.06 * scale
  ctx.strokeRect(X(-COURT.halfWidth), Z(0), COURT.halfWidth * 2 * scale, COURT.depth * scale)
  ctx.strokeRect(X(-2.45), Z(0), 4.9 * scale, 5.8 * scale)
  ctx.beginPath()
  ctx.arc(X(0), Z(5.8), 1.8 * scale, 0, Math.PI * 2)
  ctx.stroke()
  // The arc, with its straight ends along the sides.
  ctx.beginPath()
  const side = Math.sqrt(ARC * ARC - (COURT.halfWidth - 0.9) ** 2)
  ctx.moveTo(X(-(COURT.halfWidth - 0.9)), Z(0))
  ctx.lineTo(X(-(COURT.halfWidth - 0.9)), Z(RIM.z + side))
  ctx.arc(X(RIM.x), Z(RIM.z), ARC * scale, Math.PI - Math.asin(side / ARC), Math.asin(side / ARC), true)
  ctx.lineTo(X(COURT.halfWidth - 0.9), Z(0))
  ctx.stroke()
  // The small arc under the basket.
  ctx.beginPath()
  ctx.arc(X(RIM.x), Z(RIM.z), 1.25 * scale, 0, Math.PI)
  ctx.stroke()
  // The hub's zigzag along the top of the court.
  const band = 0.35 * scale
  const colours = [PALETTE.maize, PALETTE.hibiscus, PALETTE.palm, PALETTE.white]
  for (let i = 0; i * band < COURT.halfWidth * 2 * scale; i++) {
    ctx.fillStyle = colours[i % colours.length]!
    ctx.beginPath()
    const x0 = X(-COURT.halfWidth) + i * band
    ctx.moveTo(x0, Z(COURT.depth) + 0.15 * scale)
    ctx.lineTo(x0 + band / 2, Z(COURT.depth) + 0.15 * scale + band * 0.8)
    ctx.lineTo(x0 + band, Z(COURT.depth) + 0.15 * scale)
    ctx.fill()
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

/** The wall behind the court: big shapes in the hub's colours, as a street mural. */
function muralTexture(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 384
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#26203a'
  ctx.fillRect(0, 0, 1024, 384)
  const shapes: [string, number, number, number][] = [
    [PALETTE.maize, 80, 230, 140],
    [PALETTE.hibiscus, 300, 120, 170],
    [PALETTE.palm, 560, 260, 150],
    [PALETTE.indigoSoft, 800, 140, 190],
    [PALETTE.maize, 980, 300, 110],
  ]
  for (const [colour, x, y, r] of shapes) {
    ctx.fillStyle = colour
    ctx.globalAlpha = 0.85
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  // Zigzag stripes across the mural.
  ctx.strokeStyle = PALETTE.white
  ctx.lineWidth = 10
  for (const y of [70, 330]) {
    ctx.beginPath()
    for (let x = 0; x <= 1024; x += 40) ctx.lineTo(x, (x / 40) % 2 === 0 ? y : y + 26)
    ctx.stroke()
  }
  ctx.font = 'bold 72px sans-serif'
  ctx.fillStyle = PALETTE.white
  ctx.globalAlpha = 0.9
  ctx.fillText('AFRICAN GAME HUB', 250, 215)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

/** A chain-link fence: diamonds of wire. */
function fenceTexture(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.strokeStyle = 'rgba(200,210,230,0.55)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(0, 32)
  ctx.lineTo(32, 0)
  ctx.lineTo(64, 32)
  ctx.lineTo(32, 64)
  ctx.closePath()
  ctx.stroke()
  const texture = new CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = RepeatWrapping
  texture.repeat.set(30, 5)
  return texture
}

function ballTexture(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#d9631e'
  ctx.fillRect(0, 0, 256, 128)
  ctx.strokeStyle = '#2a1408'
  ctx.lineWidth = 4
  for (const x of [0, 64, 128, 192, 256]) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, 128)
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.moveTo(0, 64)
  ctx.lineTo(256, 64)
  ctx.stroke()
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

// ---- The scenery ----------------------------------------------------------------------------

function Scenery() {
  const court = useMemo(courtTexture, [])
  const mural = useMemo(muralTexture, [])
  const fence = useMemo(fenceTexture, [])
  return (
    <group>
      {/* The court, and the street around it. */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, COURT.depth / 2]} receiveShadow>
        <planeGeometry args={[COURT.halfWidth * 2 + 2, COURT.depth + 2]} />
        <meshStandardMaterial map={court} roughness={0.92} />
      </mesh>
      {/* The far half, plain: play is in the near half. */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.002, COURT.depth * 1.5]} receiveShadow>
        <planeGeometry args={[COURT.halfWidth * 2, COURT.depth]} />
        <meshStandardMaterial color="#2e4a7a" roughness={0.92} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.01, 6]}>
        <planeGeometry args={[80, 60]} />
        <meshStandardMaterial color="#252b3e" roughness={1} />
      </mesh>
      {/* The wall behind the basket, with its mural. */}
      <mesh position={[0, 4, -2.2]}>
        <boxGeometry args={[22, 8, 0.4]} />
        <meshStandardMaterial color="#2b2540" roughness={0.95} />
      </mesh>
      <mesh position={[0, 5.4, -1.99]}>
        <planeGeometry args={[18, 5.6]} />
        <meshStandardMaterial map={mural} roughness={0.9} />
      </mesh>
      {/* The fence along the far side (the camera stands on the near side). */}
      <mesh position={[-(COURT.halfWidth + 1.6), 2, COURT.depth]} rotation-y={Math.PI / 2}>
        <planeGeometry args={[COURT.depth * 2 + 4, 4]} />
        <meshStandardMaterial map={fence} transparent opacity={0.9} side={2} depthWrite={false} />
      </mesh>
      {/* Street lights. */}
      {[-1].map((side) => (
        <group key={side} position={[side * (COURT.halfWidth + 2.2), 0, 1.5]}>
          <mesh position={[0, 3.5, 0]}>
            <cylinderGeometry args={[0.07, 0.09, 7, 8]} />
            <meshStandardMaterial color="#3a3f52" />
          </mesh>
          <mesh position={[-side * 0.5, 7, 0]}>
            <boxGeometry args={[1.1, 0.12, 0.3]} />
            <meshStandardMaterial color="#3a3f52" />
          </mesh>
          <mesh position={[-side * 0.9, 6.92, 0]}>
            <boxGeometry args={[0.4, 0.05, 0.22]} />
            <meshStandardMaterial color="#fff1c2" emissive="#ffd98a" emissiveIntensity={2} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/**
 * The court made in Blender (scripts/makeBasketballCourt.py): the bought court with its fence
 * and baskets, and around it the bleachers, buildings, lights and crowd. The nets are the
 * game's own, so that they move when the ball goes through.
 */
export const COURT_URL = '/basketball/court.v4.glb'

function CourtModel() {
  const gltf = useLoader(GLTFLoader, COURT_URL)
  useMemo(() => {
    gltf.scene.traverse((o) => {
      const mesh = o as Mesh
      if (!mesh.isMesh) return
      // The ground takes the players' shadows; nothing else needs to cast or take any.
      mesh.receiveShadow = ['court', 'paving'].includes(mesh.name)
      const material = mesh.material as MeshStandardMaterial
      // Every spectator in their own outfit (the crowd is the only mesh with colours on its
      // vertices; see clothes.ts and makeBasketballCourt.py).
      if (mesh.geometry.attributes.color) {
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => m.clone()) : material.clone()
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) dyeClothes(m, 'vertex')
      }
      if (material.name === 'fence') {
        // Wire seen from both sides, with clean holes.
        material.side = DoubleSide
        material.alphaTest = 0.5
        material.transparent = false
      }
    })
  }, [gltf])
  return <primitive object={gltf.scene} />
}

function CourtWithNets({ swish }: { swish: RefObject<number> }) {
  return (
    <>
      <CourtModel />
      <Hoop swish={swish} netOnly />
      <group position={[0, 0, COURT.depth * 2]} rotation-y={Math.PI}>
        <Hoop swish={noSwish} netOnly />
      </group>
    </>
  )
}

/** The court drawn here, with both baskets: while the model downloads, in data-saver mode, or if it fails. */
function DrawnCourt({ swish }: { swish: RefObject<number> }) {
  return (
    <>
      <Scenery />
      <Hoop swish={swish} />
      <group position={[0, 0, COURT.depth * 2]} rotation-y={Math.PI}>
        <Hoop swish={noSwish} />
      </group>
    </>
  )
}

/** Soft reflections on metal and skin, from a studio-like surrounding (made in code, no download). */
function Surroundings() {
  const { gl, scene } = useThree()
  useMemo(() => {
    const pmrem = new PMREMGenerator(gl)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environmentIntensity = 0.3
    pmrem.dispose()
  }, [gl, scene])
  return null
}

function Hoop({ swish, netOnly = false }: { swish: RefObject<number>; netOnly?: boolean }) {
  const net = useRef<Mesh>(null)
  useFrame(() => {
    // The net jumps when the ball goes through, and settles.
    const since = (performance.now() - (swish.current ?? 0)) / 1000
    const squash = since < 0.6 ? 1 - Math.sin(since * 16) * 0.25 * (1 - since / 0.6) : 1
    if (net.current) net.current.scale.set(1, squash, 1)
  })
  const boardY = (BOARD.bottom + BOARD.top) / 2
  const netMesh = (
    <mesh ref={net} position={[RIM.x, RIM.y - 0.21, RIM.z]}>
      <cylinderGeometry args={[RIM.r, RIM.r * 0.62, 0.42, 16, 4, true]} />
      <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.95} />
    </mesh>
  )
  if (netOnly) return netMesh
  return (
    <group>
      {/* The post and the arm. */}
      <mesh position={[0, 1.8, 0.1]} castShadow>
        <cylinderGeometry args={[0.09, 0.11, 3.6, 12]} />
        <meshStandardMaterial color="#2f3a66" metalness={0.4} roughness={0.5} />
      </mesh>
      <mesh position={[0, 3.55, (0.1 + BOARD.z) / 2]}>
        <boxGeometry args={[0.12, 0.12, BOARD.z - 0.1]} />
        <meshStandardMaterial color="#2f3a66" metalness={0.4} roughness={0.5} />
      </mesh>
      {/* The board: glass, with its white square. */}
      {/* The board: frosted glass in a dark steel frame. */}
      <mesh position={[0, boardY, BOARD.z - 0.02]}>
        <boxGeometry args={[BOARD.halfWidth * 2, BOARD.top - BOARD.bottom, 0.04]} />
        <meshStandardMaterial color="#eef3ff" transparent opacity={0.62} roughness={0.15} />
      </mesh>
      {[
        [0, BOARD.top, BOARD.halfWidth * 2 + 0.06, 0.06],
        [0, BOARD.bottom, BOARD.halfWidth * 2 + 0.06, 0.06],
        [-BOARD.halfWidth, boardY, 0.06, BOARD.top - BOARD.bottom],
        [BOARD.halfWidth, boardY, 0.06, BOARD.top - BOARD.bottom],
      ].map(([x, y, w, h], i) => (
        <mesh key={i} position={[x!, y!, BOARD.z]}>
          <boxGeometry args={[w!, h!, 0.07]} />
          <meshStandardMaterial color="#1c2130" metalness={0.6} roughness={0.4} />
        </mesh>
      ))}
      {/* The square over the rim, painted on the glass. */}
      {[
        [0, RIM.y + 0.15 + 0.45, 0.59, 0.05],
        [0, RIM.y + 0.15, 0.59, 0.05],
        [-0.295, RIM.y + 0.375, 0.05, 0.5],
        [0.295, RIM.y + 0.375, 0.05, 0.5],
      ].map(([x, y, w, h], i) => (
        <mesh key={i} position={[x!, y!, BOARD.z + 0.004]}>
          <planeGeometry args={[w!, h!]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      ))}
      {/* The rim. */}
      <mesh position={[RIM.x, RIM.y, RIM.z]} rotation-x={Math.PI / 2} castShadow>
        <torusGeometry args={[RIM.r, 0.022, 10, 36]} />
        <meshStandardMaterial color="#e5531a" metalness={0.5} roughness={0.35} />
      </mesh>
      {/* The net. */}
      {netMesh}
    </group>
  )
}

// ---- The players ----------------------------------------------------------------------------

type Limbs = {
  root: Group
  body: Group
  armL: Group
  armR: Group
  legL: Group
  legR: Group
}

/** A stand-in player: about 1.9 m tall, in their team's colours, facing down the court (-z). */
function StandIn({ team, skin, limbs }: { team: 0 | 1; skin: string; limbs: (l: Partial<Limbs>) => void }) {
  const colours = TEAM_COLOURS[team]!
  const limb = (radius: number, length: number, colour: string) => (
    <mesh position={[0, -length / 2, 0]} castShadow>
      <capsuleGeometry args={[radius, length - radius * 2, 4, 8]} />
      <meshStandardMaterial color={colour} roughness={0.7} />
    </mesh>
  )
  return (
    <group ref={(g) => g && limbs({ root: g })}>
      <group ref={(g) => g && limbs({ body: g })}>
        {/* Legs, from the hips. */}
        <group ref={(g) => g && limbs({ legL: g })} position={[-0.13, 0.95, 0]}>
          {limb(0.085, 0.5, colours.shorts)}
          <group position={[0, -0.48, 0]}>
            {limb(0.07, 0.45, skin)}
            <mesh position={[0, -0.47, -0.05]} castShadow>
              <boxGeometry args={[0.13, 0.1, 0.28]} />
              <meshStandardMaterial color="#f4f5ff" />
            </mesh>
          </group>
        </group>
        <group ref={(g) => g && limbs({ legR: g })} position={[0.13, 0.95, 0]}>
          {limb(0.085, 0.5, colours.shorts)}
          <group position={[0, -0.48, 0]}>
            {limb(0.07, 0.45, skin)}
            <mesh position={[0, -0.47, -0.05]} castShadow>
              <boxGeometry args={[0.13, 0.1, 0.28]} />
              <meshStandardMaterial color="#f4f5ff" />
            </mesh>
          </group>
        </group>
        {/* The body: jersey, and the trim at its neck. */}
        <mesh position={[0, 1.25, 0]} castShadow>
          <capsuleGeometry args={[0.2, 0.42, 4, 10]} />
          <meshStandardMaterial color={colours.jersey} roughness={0.6} />
        </mesh>
        <mesh position={[0, 1.52, 0]}>
          <torusGeometry args={[0.1, 0.025, 6, 16]} />
          <meshStandardMaterial color={colours.trim} />
        </mesh>
        {/* The head, and a headband. */}
        <mesh position={[0, 1.7, 0]} castShadow>
          <sphereGeometry args={[0.13, 16, 12]} />
          <meshStandardMaterial color={skin} roughness={0.6} />
        </mesh>
        <mesh position={[0, 1.75, 0]} rotation-x={Math.PI / 2}>
          <torusGeometry args={[0.128, 0.022, 6, 18]} />
          <meshStandardMaterial color={colours.trim} />
        </mesh>
        {/* Arms, from the shoulders. */}
        <group ref={(g) => g && limbs({ armL: g })} position={[-0.27, 1.45, 0]}>
          {limb(0.06, 0.38, colours.jersey)}
          <group position={[0, -0.36, 0]}>{limb(0.05, 0.36, skin)}</group>
        </group>
        <group ref={(g) => g && limbs({ armR: g })} position={[0.27, 1.45, 0]}>
          {limb(0.06, 0.38, colours.jersey)}
          <group position={[0, -0.36, 0]}>{limb(0.05, 0.36, skin)}</group>
        </group>
      </group>
    </group>
  )
}

function Players({ world }: { world: RefObject<World> }) {
  const players = world.current!.game.players
  const limbs = useRef<Partial<Limbs>[]>(players.map(() => ({})))
  const run = useRef<number[]>(players.map(() => 0))
  useFrame((_, dt) => {
    const { game } = world.current!
    const ball = game.ball
    for (const p of game.players) {
      const l = limbs.current[p.id]
      if (!l?.root || !l.body || !l.armL || !l.armR || !l.legL || !l.legR) continue
      l.root.position.set(p.x, p.y, p.z)
      l.root.rotation.y = p.face
      const speed = Math.hypot(p.vx, p.vz)
      run.current[p.id]! += dt * (2 + speed * 2.1)
      const phase = run.current[p.id]!
      const stride = Math.min(1, speed / 4.5)
      const swing = Math.sin(phase) * 0.75 * stride
      // Legs run; in the air they tuck.
      const air = p.y > 0.05
      l.legL.rotation.x = air ? -0.5 : swing
      l.legR.rotation.x = air ? -0.2 : -swing
      // The body leans into a run, and wobbles when beaten.
      l.body.rotation.x = -stride * 0.18
      l.body.rotation.z = p.stumble > 0 ? Math.sin(phase * 3) * 0.25 : 0
      const holding = ball.holder === p.id
      const holder = ball.holder !== null ? game.players.find((q) => q.id === ball.holder) : undefined
      const guarding = !holding && holder !== undefined && holder.team !== p.team && Math.hypot(holder.x - p.x, holder.z - p.z) < 2.2
      if (p.shootT !== null) {
        // Both arms up, the ball overhead.
        l.armL.rotation.set(-2.9, 0, 0.15)
        l.armR.rotation.set(-2.9, 0, -0.15)
      } else if (holding) {
        // The right hand on the ball, pumping with the dribble; the left arm out to protect it.
        l.armR.rotation.set(-0.5 - Math.abs(Math.sin(ball.dribble)) * 0.5, 0, 0.1)
        l.armL.rotation.set(-0.3, 0, 0.6)
      } else if (air) {
        // Up for a block or a rebound.
        l.armL.rotation.set(-3, 0, 0.1)
        l.armR.rotation.set(-3, 0, -0.1)
      } else if (guarding) {
        // Defensive stance: arms wide.
        l.armL.rotation.set(-0.4, 0, 1.1)
        l.armR.rotation.set(-0.4, 0, -1.1)
        l.body.position.y = -0.08
      } else {
        l.armL.rotation.set(-swing * 0.8, 0, 0.12)
        l.armR.rotation.set(swing * 0.8, 0, -0.12)
      }
      if (!guarding) l.body.position.y = 0
    }
  })

  return (
    <>
      {players.map((p) => (
        <StandIn key={p.id} team={p.team} skin={SKIN[p.id % SKIN.length]!} limbs={(part) => Object.assign(limbs.current[p.id]!, part)} />
      ))}
    </>
  )
}

/** A ring under every player: gold for the player at this screen, red for the other side. */
function Rings({ world }: { world: RefObject<World> }) {
  const { game, human } = world.current!
  const mine = game.players.find((p) => p.id === human)?.team
  const rings = useRef<(Mesh | null)[]>([])
  useFrame(() => {
    for (const p of world.current!.game.players) rings.current[p.id]?.position.set(p.x, 0.02, p.z)
  })
  return (
    <>
      {game.players.map((p) => (
        <mesh key={p.id} ref={(m) => void (rings.current[p.id] = m)} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[0.42, p.id === human ? 0.54 : 0.48, 32]} />
          <meshBasicMaterial color={p.id === human ? PALETTE.maize : p.team === mine ? PALETTE.indigoSoft : PALETTE.hibiscus} transparent opacity={p.id === human ? 0.9 : 0.65} />
        </mesh>
      ))}
    </>
  )
}

/** If the character cannot be loaded, the stand-ins play instead. */
class Fallback extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

const handAt = new Vector3()
const noSwish = { current: 0 }

function Ball({ world }: { world: RefObject<World> }) {
  const mesh = useRef<Mesh>(null)
  const shadow = useRef<Mesh>(null)
  const lastPhase = useRef(0)
  const texture = useMemo(ballTexture, [])
  useFrame((_, dt) => {
    const { game, hands } = world.current!
    const ball = game.ball
    if (!mesh.current || !shadow.current) return
    mesh.current.position.set(ball.x, ball.y, ball.z)
    // In a character's hand: under the hand while dribbling, in it while shooting.
    const holder = ball.holder !== null ? game.players.find((p) => p.id === ball.holder) : undefined
    const hand = ball.holder !== null ? hands[ball.holder] : undefined
    const stroke = ball.holder !== null ? world.current!.dribble[ball.holder] : undefined
    if (holder && stroke) {
      // Pushed down from under the palm, to the floor half way through the stroke, and back up.
      const under = stroke.palm.y - BALL_R - 0.02
      const depth = 1 - Math.abs(2 * stroke.phase - 1)
      mesh.current.position.set(stroke.palm.x, under + (BALL_R - under) * depth, stroke.palm.z)
      if (lastPhase.current < 0.5 && stroke.phase >= 0.5) bounceSound(3)
      lastPhase.current = stroke.phase
    } else if (holder && hand) {
      hand.getWorldPosition(handAt)
      if (holder.shootT !== null) mesh.current.position.set(handAt.x, handAt.y + BALL_R, handAt.z)
      else mesh.current.position.set(handAt.x, ball.y, handAt.z)
    }
    // Spinning as it flies or rolls.
    mesh.current.rotation.x -= (ball.vz / BALL_R) * dt * 0.5
    mesh.current.rotation.z += (ball.vx / BALL_R) * dt * 0.5
    shadow.current.position.set(mesh.current.position.x, 0.015, mesh.current.position.z)
    const lift = Math.min(1, ball.y / 4)
    shadow.current.scale.setScalar(1 - lift * 0.5)
  })
  return (
    <>
      <mesh ref={mesh} castShadow>
        <sphereGeometry args={[BALL_R, 24, 16]} />
        <meshStandardMaterial map={texture} roughness={0.75} />
      </mesh>
      <mesh ref={shadow} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[BALL_R * 1.1, 20]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.35} />
      </mesh>
    </>
  )
}

/**
 * The camera behind the player at this screen, turned around him by the player's finger
 * (View), keeping him and the ball in the picture. It turns smoothly to where the finger has
 * put it, never goes under the floor or through the fence, and at each check it swings round
 * behind him, facing the basket.
 */
const DISTANCE = 6.4
const BOUNDS = { minX: -8.5, maxX: 12, minZ: -0.7, maxZ: 29 }
function Follow({ world }: { world: RefObject<World> }) {
  const { camera, size } = useThree()
  const look = useRef(new Vector3(0, 1.3, 8))
  const turned = useRef({ yaw: Math.PI, pitch: PITCH.start as number })
  const phase = useRef<string | null>(null)
  useFrame((_, dt) => {
    const { game, human, view } = world.current!
    const ball = game.ball
    const me = game.players.find((p) => p.id === human) ?? game.players[0]!
    if (game.phase === 'check' && phase.current !== 'check') {
      // A new possession: behind the player, facing the basket.
      view.yaw = Math.atan2(RIM.x - me.x, RIM.z - me.z)
      view.pitch = PITCH.start
    }
    phase.current = game.phase
    // Smoothly to where the finger has turned it (the shortest way round).
    const k = Math.min(1, dt * 10)
    let dYaw = view.yaw - turned.current.yaw
    dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw))
    turned.current.yaw += dYaw * k
    turned.current.pitch += (view.pitch - turned.current.pitch) * k
    const { yaw, pitch } = turned.current
    // Looking at the player, a little toward the ball.
    const target = new Vector3(me.x * 0.8 + ball.x * 0.2, 1.3, me.z * 0.8 + ball.z * 0.2)
    look.current.lerp(target, Math.min(1, dt * 8))
    const portrait = size.height > size.width
    const distance = portrait ? DISTANCE * 1.25 : DISTANCE
    const goal = new Vector3(
      look.current.x - Math.sin(yaw) * Math.cos(pitch) * distance,
      look.current.y + Math.sin(pitch) * distance,
      look.current.z - Math.cos(yaw) * Math.cos(pitch) * distance,
    )
    // Inside the fence and above the floor: pulled in toward the player rather than through.
    goal.x = Math.min(Math.max(goal.x, BOUNDS.minX), BOUNDS.maxX)
    goal.z = Math.min(Math.max(goal.z, BOUNDS.minZ), BOUNDS.maxZ)
    goal.y = Math.max(goal.y, 0.8)
    camera.position.lerp(goal, Math.min(1, dt * 9))
    camera.lookAt(look.current)
  })
  return null
}

export function Court3D({ world, swish }: { world: RefObject<World>; swish: RefObject<number> }) {
  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      // Measured by its own size, not as it appears on screen: the game may be drawn turned a quarter.
      resize={{ offsetSize: true }}
      camera={{ fov: 55, near: 0.1, far: 140, position: [0, 3.2, 14] }}
      gl={{ antialias: true, powerPreference: 'high-performance', toneMappingExposure: 1.3 }}
      onCreated={({ scene }) => {
        scene.background = null
      }}
      style={{ touchAction: 'none' }}
    >
      <color attach="background" args={['#141b45']} />
      <fog attach="fog" args={['#141b45', 30, 70]} />
      <Surroundings />
      <hemisphereLight args={['#9fb0ff', '#3a2f48', 1.25]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[6, 12, 9]} intensity={1.6} color="#ffe2b0" castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={14} shadow-camera-bottom={-4} />
      {/* A soft light from behind the camera, so the players' faces and clothes read on the dark court. */}
      <directionalLight position={[18, 6, 8]} intensity={1.4} color="#f4f0ff" />
      {/* The street lamps along the far side, over the court. */}
      {[
        [-8.2, -0.5],
        [-8.2, 7],
        [-8.2, 17],
      ].map(([x, z]) => (
        <pointLight key={`${x}:${z}`} position={[x!, 6.9, z!]} intensity={30} distance={24} decay={1.6} color="#ffd98a" />
      ))}
      {/* The court from Blender; the court drawn here while it downloads, in data-saver mode, or if it fails. */}
      {/* Play is in the near half (street rules); the far basket is for the look of a full court. */}
      {useSettingsStore.getState().dataSaver ? (
        <DrawnCourt swish={swish} />
      ) : (
        <Fallback fallback={<DrawnCourt swish={swish} />}>
          <Suspense fallback={<DrawnCourt swish={swish} />}>
            <CourtWithNets swish={swish} />
          </Suspense>
        </Fallback>
      )}
      {/* The characters; the stand-ins while they download, in data-saver mode, or if they fail. */}
      {useSettingsStore.getState().dataSaver ? (
        <Players world={world} />
      ) : (
        <Fallback fallback={<Players world={world} />}>
          <Suspense fallback={<Players world={world} />}>
            <Athletes world={world} />
          </Suspense>
        </Fallback>
      )}
      <Rings world={world} />
      <Ball world={world} />
      <Follow world={world} />
    </Canvas>
  )
}
