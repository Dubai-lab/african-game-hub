// The cues a player can choose from. A cue is looks only: every cue hits the same.

// (shaft, wrap: light, middle, shade, across the cue. butt: its middle tone, with a lighter and a darker.)
export const CUES = {
  maple: { shaft: ['#f6e2b6', '#d2a565', '#8d6230'], butt: '#3a2a1c', buttLight: '#6a4d33', buttDark: '#170f09', wrap: ['#3f3f46', '#1d1d22', '#08080a'], band: '#b0372b' },
  ebony: { shaft: ['#8a7563', '#3a2c22', '#1c1410'], butt: '#15110f', buttLight: '#4a3d35', buttDark: '#050404', wrap: ['#7a2a2a', '#4a1414', '#1f0707'], band: '#d9b24a' },
  ocean: { shaft: ['#d6eeff', '#4fa3e0', '#15568c'], butt: '#0f335a', buttLight: '#2f6aa8', buttDark: '#061627', wrap: ['#f4efe2', '#c9c2b0', '#8a8372'], band: '#f4efe2' },
  kente: { shaft: ['#ffe9a3', '#f6b800', '#a87300'], butt: '#0f5a36', buttLight: '#2a9463', buttDark: '#062b19', wrap: ['#e0344a', '#a31c30', '#5a0d19'], band: '#d6283b' },
} as const
export type CueId = keyof typeof CUES
export const CUE_IDS = Object.keys(CUES) as CueId[]

/** The cue as a CSS picture, tip first: chalk, ferrule, shaft, then the wrapped butt. */
export function cueGradient(id: CueId, direction: 'to bottom' | 'to right' = 'to bottom'): string {
  const cue = CUES[id]
  return `linear-gradient(${direction}, #3d7fd6 0 1.5%, #f4efe2 1.5% 5%, ${cue.shaft[0]} 5%, ${cue.shaft[1]} 52%, ${cue.band} 52% 54%, ${cue.butt} 54% 74%, ${cue.band} 74% 76%, ${cue.butt} 76% 100%)`
}
