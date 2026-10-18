// One Africa Life: a person in 3D, dressed by an appearance. One file per sex
// (public/oal/creator-<sex>.v2.glb, made by scripts/oal/makeCreatorAssets.py) carries every body
// shape as morphs, every hairstyle and outfit, the body's marks of what each outfit covers, and
// the movements (idle, walk, talk). The creator dresses it live; the game dresses copies of it
// for the player and for everyone else (an officer is a person in a navy uniform).
import { BufferAttribute, Color, type Material, type Mesh, type MeshStandardMaterial, type Object3D, Vector4 } from 'three'
import { type Appearance, CATALOGUE, type Sex } from '../../../supabase/functions/_shared/oal'

export const CHARACTER_URL = (sex: Sex) => `/oal/creator-${sex}.v2.glb`

const HAIR_COLOURS: Record<string, string> = { black: '#2a2522', darkbrown: '#4a3426', brown: '#7a5233', auburn: '#8c3b22' }
const EYE_COLOURS: Record<string, string> = { darkbrown: '#3a2416', brown: '#6b4024', hazel: '#7a6a35' }

/** The meshes under a named node (the packed file puts each mesh inside its named node). */
export function meshesOf(node: Object3D | undefined): Mesh[] {
  const out: Mesh[] = []
  node?.traverse((o) => {
    if ((o as Mesh).isMesh) out.push(o as Mesh)
  })
  return out
}

/** A shader change on a material: uniform colours, and GLSL run after the picture is read. */
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

export type Look = {
  /** Dresses the person: body and face, skin, hair, eyes, outfit; a colour over the outfit (a uniform). */
  apply: (appearance: Appearance, options?: { outfitTint?: string }) => void
}

/**
 * Makes a person's materials its own (a copy of the file's, or of a clone's), with the colours
 * as uniforms so that changing them never rebuilds a shader. Call once per person.
 */
export function prepare(scene: Object3D): Look {
  const colours = {
    skinTone: { value: 0.7 },
    hairColour: { value: new Color() },
    eyeColour: { value: new Color() },
    outfitTint: { value: new Color(1, 1, 1) },
    hideChannel: { value: new Vector4() },
  }
  scene.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
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
    if (!mesh.geometry.getAttribute('color')) mesh.geometry.setAttribute('color', new BufferAttribute(new Float32Array(mesh.geometry.getAttribute('position').count * 4), 4))
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
    if (o.name.startsWith('outfit_')) {
      // A uniform: the clothes' own folds kept, their colour multiplied by the tint (white: none).
      for (const mesh of meshesOf(o)) paint(mesh.material as Material, 'oal-outfit', 'diffuseColor.rgb = mix(diffuseColor.rgb, outfitTint * (0.35 + 1.6 * dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114))), step(outfitTint.r + outfitTint.g + outfitTint.b, 2.99));', { outfitTint: colours.outfitTint })
    }
  })
  for (const mesh of meshesOf(scene.getObjectByName('eyes'))) {
    // The iris (the dark of the eye picture) in the colour chosen; the white stays white.
    paint(mesh.material as Material, 'oal-eyes', 'float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)); diffuseColor.rgb = mix(eyeColour * (0.4 + lum * 2.5), diffuseColor.rgb, smoothstep(0.25, 0.55, lum));', { eyeColour: colours.eyeColour })
  }

  return {
    apply(appearance, options = {}) {
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
      const channel = (CATALOGUE.outfit[appearance.sex] as readonly string[]).indexOf(appearance.outfit)
      colours.hideChannel.value.set(channel === 0 ? 1 : 0, channel === 1 ? 1 : 0, channel === 2 ? 1 : 0, channel === 3 ? 1 : 0)
      // Height: the whole person a little taller or shorter (7% either way), evenly.
      scene.scale.setScalar(1 + appearance.build.height * 0.07)
      colours.skinTone.value = appearance.skin
      colours.hairColour.value.set(HAIR_COLOURS[appearance.hairColour] ?? HAIR_COLOURS.black!)
      colours.eyeColour.value.set(EYE_COLOURS[appearance.eyes] ?? EYE_COLOURS.darkbrown!)
      colours.outfitTint.value.set(options.outfitTint ?? '#ffffff')
    },
  }
}
