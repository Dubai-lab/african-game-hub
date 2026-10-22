// One Africa Life: the character in the creator, in 3D, standing and breathing, lit like a film
// still. Every choice is applied live (./character.ts dresses the person).
//
// Loaded only on the creator's page (three.js stays out of the rest of the app).
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { type RefObject, Suspense, useEffect, useMemo, useRef } from 'react'
import { AnimationMixer, type Mesh, type Object3D, PMREMGenerator, Vector3 } from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { packed } from './gltf'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Appearance } from '../../../supabase/functions/_shared/oal'
import { CHARACTER_URL, prepare } from './character'


/** How the camera frames the character: the whole person, or the face. */
export type Framing = 'full' | 'face'

function Character({ appearance, framing }: { appearance: Appearance; framing: Framing }) {
  const gltf = useLoader(GLTFLoader, CHARACTER_URL(appearance.sex), packed)

  // Once per file: the person's own materials, shadows, the idle.
  const { look, mixer } = useMemo(() => {
    const look = prepare(gltf.scene)
    gltf.scene.traverse((o) => {
      if ((o as Mesh).isMesh) (o as Mesh).castShadow = true
    })
    const mixer = new AnimationMixer(gltf.scene)
    const idle = gltf.animations.find((a) => a.name === 'idle') ?? gltf.animations[0]
    if (idle) mixer.clipAction(idle).play()
    return { look, mixer }
  }, [gltf])

  // Every choice, applied live.
  useEffect(() => look.apply(appearance), [look, appearance])

  useFrame((_, dt) => mixer.update(Math.min(dt, 0.1)))
  return (
    <>
      <primitive object={gltf.scene} />
      <Framer framing={framing} />
    </>
  )
}

/** The camera eases between the whole person and a close look at the face. */
function Framer({ framing }: { framing: Framing }) {
  const { camera } = useThree()
  const look = useRef(new Vector3(0, 1, 0))
  useFrame((_, dt) => {
    const k = Math.min(1, dt * 4)
    const goal = framing === 'face' ? new Vector3(0, 1.62, 1.25) : new Vector3(0, 1.05, 3.6)
    const at = framing === 'face' ? new Vector3(0, 1.6, 0) : new Vector3(0, 0.92, 0)
    camera.position.lerp(goal, k)
    look.current.lerp(at, k)
    camera.lookAt(look.current)
  })
  return null
}

/** Soft reflections, from a studio made in code (no download). */
function Studio() {
  const { gl, scene } = useThree()
  useMemo(() => {
    const pmrem = new PMREMGenerator(gl)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environmentIntensity = 0.5
    pmrem.dispose()
  }, [gl, scene])
  return null
}

/** Dragged sideways, the character turns. */
function Turntable({ turn, children }: { turn: RefObject<number>; children: React.ReactNode }) {
  const group = useRef<Object3D>(null)
  useFrame(() => {
    if (group.current) group.current.rotation.y += ((turn.current ?? 0) - group.current.rotation.y) * 0.2
  })
  return <group ref={group}>{children}</group>
}

export default function CreatorScene({ appearance, framing, turn }: { appearance: Appearance; framing: Framing; turn: RefObject<number> }) {
  return (
    <Canvas shadows dpr={[1, 1.5]} camera={{ fov: 30, near: 0.05, far: 50, position: [0, 1.05, 3.6] }} gl={{ antialias: true, toneMappingExposure: 1.1 }} style={{ touchAction: 'none' }}>
      <color attach="background" args={['#141a44']} />
      <Studio />
      <hemisphereLight args={['#c9d2ff', '#3a2f48', 0.6]} />
      <directionalLight position={[-2.4, 3, 2.6]} intensity={2.3} color="#ffe9d6" castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[2.6, 1.8, 2]} intensity={0.8} color="#d4dcff" />
      <directionalLight position={[0.5, 2.6, -2.8]} intensity={1.6} color="#fff2e2" />
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[1.4, 48]} />
        <meshStandardMaterial color="#1d2560" roughness={0.9} />
      </mesh>
      <Suspense fallback={null}>
        <Turntable turn={turn}>
          <Character appearance={appearance} framing={framing} />
        </Turntable>
      </Suspense>
    </Canvas>
  )
}
