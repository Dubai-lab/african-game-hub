// The characters' clothes in colours: the Mixamo character wears near-black clothes, so a
// colour cannot simply be multiplied in. The shader finds the cloth in the character's own
// texture (very dark and without colour, unlike skin, eyes and shoes, measured on the
// texture) and paints it in a colour instead, keeping the folds: the cloth's own light and
// shade scale the colour.
//
// The colour is either one for the whole character (a team) or each vertex's own (the crowd,
// where every spectator was given an outfit when the court was made in Blender).
import { type Color, type Material, type MeshStandardMaterial } from 'three'

const DYE = /* glsl */ `
  {
    float light = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    float colourful = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)) - min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));
    float cloth = (1.0 - smoothstep(0.012, 0.022, light)) * (1.0 - smoothstep(0.012, 0.025, colourful));
    vec3 dyed = DYE_COLOUR * clamp(light / 0.0068, 0.45, 1.6) * 0.6;
    diffuseColor.rgb = mix(diffuseColor.rgb, dyed, cloth);
  }
`

/** Paints the cloth in `material` in `colour` (linear), or in each vertex's colour when 'vertex'. */
export function dyeClothes(material: Material, colour: Color | 'vertex') {
  const m = material as MeshStandardMaterial
  if (!m.map) return
  if (colour === 'vertex') {
    m.vertexColors = true
    m.onBeforeCompile = (shader) => {
      // The vertex colour is the outfit, not a tint over everything (skin stays skin).
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <color_fragment>', '')
        .replace('#include <map_fragment>', `#include <map_fragment>\n#define DYE_COLOUR vColor.rgb\n${DYE}`)
    }
    m.customProgramCacheKey = () => 'dye-vertex'
  } else {
    m.onBeforeCompile = (shader) => {
      shader.uniforms.dyeColour = { value: colour }
      shader.fragmentShader = `uniform vec3 dyeColour;\n${shader.fragmentShader}`.replace(
        '#include <map_fragment>',
        `#include <map_fragment>\n#define DYE_COLOUR dyeColour\n${DYE}`,
      )
    }
    m.customProgramCacheKey = () => 'dye-uniform'
  }
  m.needsUpdate = true
}
