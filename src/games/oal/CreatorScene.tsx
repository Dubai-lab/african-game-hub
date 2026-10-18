// One Africa Life: the character in the creator, in 3D, standing and breathing, lit like a film
// still. Every choice is applied live to one file per sex (public/oal/creator-<sex>.v1.glb, made
// by scripts/oal/makeCreatorAssets.py): the sliders move the body's morphs, and everything worn
// carries the same morphs so it follows; the outfit picked hides the body under it (the body
// carries, for each outfit, a mark on each point it covers); skin, hair and eye colours are
// painted over the pictures.
//
// Loaded only on the creator's page (three.js stays out of the rest of the app).
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { type RefObject, Suspense, useEffect, useMemo, useRef } from 'react'
import { AnimationMixer, BufferAttribute, Color, type Material, type Mesh, type MeshStandardMaterial, type Object3D, PMREMGenerator, Vector3, Vector4 } from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { type Appearance, CATALOGUE, type Sex } from '../../../supabase/functions/_shared/oal'

export const CREATOR_URL = (sex: Sex) => `/oal/creator-${sex}.v1.glb`

/** How the camera frames the character: the whole person, or the face. */
export type Framing = 'full' | 'face'

const HAIR_COLOURS: Record<string, string> = { black: '#2a2522', darkbrown: '#4a3426', brown: '#7a5233', auburn: '#8c3b22' }
const EYE_COLOURS: Record<string, string> = { darkbrown: '#3a2416', brown: '#6b4024', hazel: '#7a6a35' }

/** The meshes under a named node (the packed file puts each mesh inside its named node). */
function meshesOf(node: Object3D | undefined): Mesh[] {
  const out: Mesh[] = []
  node?.traverse((o) => {
    if ((o as Mesh).isMesh) out.push(o as Mesh)
  })
  return out
}

/** A shader change on a material: a uniform colour, and GLSL run after the picture is read. */
function paint(material: Material, key: string, glsl: string, uniforms: Record<string, { value: unknown }>) {
  const m = material as MeshStandardMaterial
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    const declare = Object.keys(uniforms)
      .map((name) => `uniform ${typeof uniforms[name]!.value === 'number' ? 'float' : 'vec3'} ${name};`)
      .join('\n')
    shader.fragmentShader = `${declare}\n${shader.fragmentShader}`.replace('#include <map_fragment>', `#include <map_fragment>\n${glsl}`)
  }
  m.customProgramCacheKey = () => key
  m.needsUpdate = true
}

function Character({ appearance, framing }: { appearance: Appearance; framing: Framing }) {
  const gltf = useLoader(GLTFLoader, CREATOR_URL(appearance.sex), (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  // The colours as uniforms: changed in place, the shaders are not built again.
  const colours = useMemo(() => ({ skinTone: { value: 0.7 }, hairColour: { value: new Color() }, eyeColour: { value: new Color() }, hideChannel: { value: new Vector4() } }), [])

  // Once per file: materials made the creator's own, shadows, the idle.
  const mixer = useMemo(() => {
    const scene = gltf.scene
    scene.traverse((o) => {
      const mesh = o as Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = true
      mesh.frustumCulled = false
      mesh.material = (mesh.material as Material).clone()
    })
    for (const mesh of meshesOf(scene.getObjectByName('body'))) {
      // The skin's tone, from light to the darkest of the African skins, keeping its own shading;
      // and what the outfit covers completely is not drawn (its marks: a channel of the body's
      // vertex colour, in the catalogue's order).
      const m = mesh.material as MeshStandardMaterial
      m.onBeforeCompile = (shader) => {
        shader.uniforms.skinTone = colours.skinTone
        shader.uniforms.hideChannel = colours.hideChannel
        shader.vertexShader = `attribute vec4 color;\nuniform vec4 hideChannel;\nvarying float vHide;\n${shader.vertexShader}`.replace('#include <begin_vertex>', '#include <begin_vertex>\nvHide = dot(color, hideChannel);')
        shader.fragmentShader = `uniform float skinTone;\nvarying float vHide;\n${shader.fragmentShader}`
          .replace('void main() {', 'void main() {\n  if (vHide > 0.99) discard;')
          .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= mix(vec3(2.3, 1.95, 1.75), vec3(0.85, 0.8, 0.78), skinTone);')
      }
      m.vertexColors = false
      m.customProgramCacheKey = () => 'oal-skin'
      m.needsUpdate = true
    }
    scene.traverse((o) => {
      if (o.name.startsWith('hair_')) {
        for (const mesh of meshesOf(o)) {
          const m = mesh.material as MeshStandardMaterial
          m.alphaTest = 0.35
          m.transparent = false
          paint(m, 'oal-hair', 'diffuseColor.rgb = hairColour * (0.35 + 2.4 * dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)));', { hairColour: colours.hairColour })
        }
      }
    })
    for (const mesh of meshesOf(scene.getObjectByName('eyes'))) {
      // The iris (the dark of the eye picture) in the colour chosen; the white stays white.
      paint(mesh.material as Material, 'oal-eyes', 'float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)); diffuseColor.rgb = mix(eyeColour * (0.4 + lum * 2.5), diffuseColor.rgb, smoothstep(0.25, 0.55, lum));', { eyeColour: colours.eyeColour })
    }
    const mixer = new AnimationMixer(scene)
    const idle = gltf.animations.find((a) => a.name === 'idle') ?? gltf.animations[0]
    if (idle) mixer.clipAction(idle).play()
    return mixer
  }, [gltf, colours])

  // Every choice, applied live.
  useEffect(() => {
    const scene = gltf.scene
    const outfit = scene.getObjectByName(`outfit_${appearance.outfit}`)
    const shoes = (outfit?.userData as { shoes?: string } | undefined)?.shoes
    scene.traverse((o) => {
      if (o.name.startsWith('hair_')) o.visible = o.name === `hair_${appearance.hair}`
      else if (o.name.startsWith('outfit_')) o.visible = o.name === `outfit_${appearance.outfit}`
      else if (o.name.startsWith('shoes_')) o.visible = o.name === shoes
    })
    // The sliders: each a "min" and a "max" morph either side of the average.
    scene.traverse((o) => {
      const mesh = o as Mesh
      if (!mesh.isMesh || !mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return
      for (const [name, index] of Object.entries(mesh.morphTargetDictionary)) {
        const [group, field, end] = name.split('_') as [string, string, string]
        const value = group === 'build' ? appearance.build[field as keyof Appearance['build']] : group === 'face' ? appearance.face[field as keyof Appearance['face']] : 0
        mesh.morphTargetInfluences[index] = end === 'min' ? Math.max(0, -(value ?? 0)) : Math.max(0, value ?? 0)
      }
    })
    // The body under the outfit: that outfit's channel of the marks (none if the file has none).
    const channel = (CATALOGUE.outfit[appearance.sex] as readonly string[]).indexOf(appearance.outfit)
    colours.hideChannel.value.set(channel === 0 ? 1 : 0, channel === 1 ? 1 : 0, channel === 2 ? 1 : 0, channel === 3 ? 1 : 0)
    for (const mesh of meshesOf(scene.getObjectByName('body'))) {
      if (!mesh.geometry.getAttribute('color')) mesh.geometry.setAttribute('color', new BufferAttribute(new Float32Array(mesh.geometry.getAttribute('position').count * 4), 4))
    }
    // Height: the whole person a little taller or shorter (7% either way), evenly.
    scene.scale.setScalar(1 + appearance.build.height * 0.07)
    colours.skinTone.value = appearance.skin
    colours.hairColour.value.set(HAIR_COLOURS[appearance.hairColour] ?? HAIR_COLOURS.black!)
    colours.eyeColour.value.set(EYE_COLOURS[appearance.eyes] ?? EYE_COLOURS.darkbrown!)
  }, [gltf, appearance, colours])

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
