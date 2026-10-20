// One Africa Life: on the road up-country, in 3D. The player's own character sits by the window
// of the shared car or the bus (seen through its glass), and the road (scripts/oal/makeRoadKit.py:
// laterite through the bush, public/oal/road-kit.v1.glb) runs past at the speed of the journey:
// still while the car fills or the bus waits, then on its way. Loaded only here.
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { Suspense, useMemo } from 'react'
import { Color, type Material, type Mesh, type Object3D, PMREMGenerator, Vector3 } from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Appearance } from '../../../supabase/functions/_shared/oal'
import { person } from './ArrivalsScene'
import { CHARACTER_URL } from './character'
import { VEHICLES_URL } from './Traffic'

export const ROAD_URL = '/oal/road-kit.v1.glb'
const STRETCH = 120
// Where the passenger sits, in the vehicle's own frame (x ahead, y up, z to its right).
const SEAT = { car: new Vector3(0.15, 0.08, 0.42), bus: new Vector3(0.6, 0.78, 1.05) }

function Road({ moving }: { moving: () => number }) {
  const gltf = useLoader(GLTFLoader, ROAD_URL, (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  // Five stretches in a row, from the three in the file, carried past and round again.
  const pieces = useMemo(() => {
    const kinds = [0, 1, 2].map((n) => gltf.scene.getObjectByName(`stretch_${n}`)!).filter(Boolean)
    return [-1, 0, 1, 2, 3].map((k, i) => {
      const o = kinds[i % kinds.length]!.clone(true)
      o.position.x = k * STRETCH
      return o
    })
  }, [gltf])
  useFrame((_, raw) => {
    const step = moving() * Math.min(raw, 0.1)
    for (const p of pieces) {
      p.position.x -= step
      if (p.position.x < -2 * STRETCH) p.position.x += pieces.length * STRETCH
    }
  })
  return (
    <>
      {pieces.map((p, i) => (
        <primitive key={i} object={p} />
      ))}
    </>
  )
}

function Ride({ mode, appearance, moving }: { mode: 'car' | 'bus'; appearance: Appearance; moving: () => number }) {
  const cars = useLoader(GLTFLoader, VEHICLES_URL, (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const body = useLoader(GLTFLoader, CHARACTER_URL(appearance.sex), (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const { camera } = useThree()
  const { vehicle, rider } = useMemo(() => {
    const vehicle = cars.scene.getObjectByName(mode === 'bus' ? 'bus' : 'sedan')!.clone(true) as Object3D
    // A shared car up-country is any colour; this one a taxi's yellow.
    vehicle.traverse((o) => {
      const mesh = o as Mesh
      if (!mesh.isMesh) return
      const tint = (m: Material) => {
        if (!m.name.startsWith('paint')) return m
        const c = m.clone() as Material & { color: Color }
        c.color = new Color('#e9b51c')
        return c
      }
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(tint) : tint(mesh.material)
    })
    // The road's right-hand lane.
    vehicle.position.set(0, 0.03, 1.75)
    const rider = person(body.scene, body.animations, appearance)
    const sit = rider.actions.sit ?? rider.actions.idle
    sit?.play()
    rider.root.position.copy(SEAT[mode]).add(vehicle.position)
    // Facing the way the vehicle goes (+x).
    rider.root.rotation.y = Math.PI / 2
    return { vehicle, rider }
  }, [cars, body, mode, appearance])
  const look = useMemo(() => new Vector3(), [])
  useFrame((state, raw) => {
    const dt = Math.min(raw, 0.1)
    rider.mixer.update(dt)
    // The road's bumps, a little, when moving.
    const t = state.clock.elapsedTime
    const bump = moving() > 0 ? Math.sin(t * 9) * 0.012 + Math.sin(t * 3.1) * 0.01 : 0
    vehicle.position.y = 0.03 + bump
    rider.root.position.y = SEAT[mode].y + 0.03 + bump
    // The camera beside the window, a little ahead, looking at the rider.
    // Far enough to see the car and the road on a phone held upright.
    const side = mode === 'bus' ? 7.5 : 5.2
    camera.position.set(2.6 + Math.sin(t * 0.15) * 0.4, mode === 'bus' ? 2.6 : 1.7, vehicle.position.z + side)
    look.set(rider.root.position.x + 0.2, rider.root.position.y + (mode === 'bus' ? 0.9 : 0.75), rider.root.position.z)
    camera.lookAt(look)
  })
  return (
    <>
      <primitive object={vehicle} />
      <primitive object={rider.root} />
    </>
  )
}

function Sky() {
  const { gl, scene } = useThree()
  useMemo(() => {
    const pmrem = new PMREMGenerator(gl)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environmentIntensity = 0.45
    pmrem.dispose()
  }, [gl, scene])
  return null
}

/** The journey: mode, how the rider looks, and whether it is under way (metres a second now). */
export default function RoadScene({ mode, appearance, speed }: { mode: 'car' | 'bus'; appearance: Appearance; speed: () => number }) {
  return (
    <Canvas dpr={[1, 1.5]} camera={{ fov: 50, near: 0.1, far: 220, position: [2, 1.5, 5] }} gl={{ antialias: true }} style={{ touchAction: 'none' }}>
      <color attach="background" args={['#a9c9ea']} />
      <fog attach="fog" args={['#c4d6e6', 60, 200]} />
      <Sky />
      <hemisphereLight args={['#eaf2ff', '#7a5a3c', 1.0]} />
      <directionalLight position={[-60, 90, 40]} intensity={2.2} color="#fff1dc" />
      <Suspense fallback={null}>
        <Road moving={speed} />
        <Ride mode={mode} appearance={appearance} moving={speed} />
      </Suspense>
    </Canvas>
  )
}
