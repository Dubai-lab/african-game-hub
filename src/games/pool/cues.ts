// The cues a player can choose from. A cue is looks only: every cue hits the same.

export const CUES = {
  maple: { shaft: ['#f1d9a6', '#c9995a', '#8d6230'], butt: '#2b2118', band: '#b0372b' },
  ebony: { shaft: ['#7a6756', '#3a2c22', '#1c1410'], butt: '#0d0b0a', band: '#d9b24a' },
  ocean: { shaft: ['#bfe3ff', '#3f97d8', '#15568c'], butt: '#0b2440', band: '#f4efe2' },
  kente: { shaft: ['#ffe08a', '#f6b800', '#b07a00'], butt: '#0f5a36', band: '#d6283b' },
} as const
export type CueId = keyof typeof CUES
export const CUE_IDS = Object.keys(CUES) as CueId[]

/** The cue as a CSS picture, tip first: chalk, ferrule, shaft, then the wrapped butt. */
export function cueGradient(id: CueId, direction: 'to bottom' | 'to right' = 'to bottom'): string {
  const cue = CUES[id]
  return `linear-gradient(${direction}, #3d7fd6 0 1.5%, #f4efe2 1.5% 5%, ${cue.shaft[0]} 5%, ${cue.shaft[1]} 52%, ${cue.band} 52% 54%, ${cue.butt} 54% 74%, ${cue.band} 74% 76%, ${cue.butt} 76% 100%)`
}
