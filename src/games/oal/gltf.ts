// One Africa Life's 3D files as they are loaded: their shapes packed (meshopt), their pictures
// in the form a graphics chip reads as it is (KTX2: Basis, turned on the device into the chip's
// own compressed form: ASTC on phones, BC on computers), so a picture takes a fraction of the
// memory it would unpacked. Every loader of the game's files is set up by `packed`.
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { Group, type Material, type Mesh, type MeshPhysicalMaterial, type Object3D } from 'three'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

let ktx2: KTX2Loader | null = null

/** The KTX2 loader, made once: what this device's graphics chip reads found by asking it (a
 * moment's context of its own, the game's own not yet there when files start loading). */
function ktx2Loader() {
  if (ktx2) return ktx2
  ktx2 = new KTX2Loader().setTranscoderPath('/basis/').setWorkerLimit(2)
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
  const extensions = { has: (name: string) => Boolean(gl?.getExtension(name)), get: (name: string) => gl?.getExtension(name) }
  ktx2.detectSupport({ extensions } as unknown as Parameters<KTX2Loader['detectSupport']>[0])
  ;(gl?.getExtension('WEBGL_lose_context') as { loseContext?: () => void } | null)?.loseContext?.()
  return ktx2
}

const retried = new WeakSet<GLTFLoader>()

/** A loader set up for the game's files (for useLoader's third argument): and, on a weak
 * connection, a file that fails tried again (four times, waiting longer each time) before the
 * game says it could not be loaded. */
export function packed(loader: GLTFLoader) {
  loader.setMeshoptDecoder(MeshoptDecoder)
  loader.setKTX2Loader(ktx2Loader())
  if (retried.has(loader)) return
  retried.add(loader)
  // Glass that bends the light behind it (a material's transmission) costs the whole scene drawn
  // a second time each frame, every material's shader made twice: plain see-through glass instead.
  loader.register(() => ({
    name: 'oal-plain-glass',
    afterRoot: async (result: { scene: Object3D }) => {
      result.scene.traverse((o) => {
        const mesh = o as Mesh
        if (!mesh.isMesh) return
        for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as Material[]) {
          const p = m as MeshPhysicalMaterial
          if (!p.isMeshPhysicalMaterial || !(p.transmission > 0)) continue
          p.transmission = 0
          p.transparent = true
          p.opacity = Math.min(p.opacity, 0.35)
          p.depthWrite = false
        }
      })
    },
  }))
  const load = loader.load.bind(loader)
  loader.load = (url, onLoad, onProgress, onError) => {
    let tries = 0
    const attempt = () =>
      load(url, onLoad, onProgress, (e) => {
        if (++tries < 5) setTimeout(attempt, 1500 * tries)
        else onError?.(e)
      })
    attempt()
  }
}

/** Models' shaders made before they are first seen (in the background, where the graphics chip
 * can: a model first drawn would otherwise hold the frame while its shaders are made). Hidden
 * ones too (every mesh under them is gone through). */
export function useWarm(objects: (Object3D | null | undefined)[]) {
  const { gl, camera, scene } = useThree()
  useEffect(() => {
    const list = objects.filter((o): o is Object3D => Boolean(o))
    if (!list.length) return
    // (Gathered for the call only: each stays where it is, its parent its own.)
    const holder = new Group()
    holder.children.push(...list)
    void gl.compileAsync(holder, camera, scene).catch(() => {})
    holder.children.length = 0
  }, objects) // eslint-disable-line react-hooks/exhaustive-deps
}
