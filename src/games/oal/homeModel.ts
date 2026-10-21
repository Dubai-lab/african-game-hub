// The game's own places built by scripts/oal/makeHome.py (public/oal/home.v5.glb and
// ./homePlan.json): the family house on its plot, the Ministry of Health's compound, the shops on
// Tubman Boulevard. Shared by their insides (./HomeScene.tsx) and the town round them
// (./city/CityScene.tsx), where the house and the Ministry stand in their compounds.
import plans from './homePlan.json'

export const HOME_URL = '/oal/home.v5.glb'

/** What each place had outside it before the town was built round it: its street, pavement,
 * verge, the neighbours across (never drawn now: out of the door is the town itself). */
export const OUTSIDE = /^(street|verge|neighbours|.*_(street|pavement|verge|across))$/

type Rect = number[]
type CompoundPlan = { solids: Rect[]; places: Record<string, { x: number; y: number }>; doors?: { name: string; cx: number; cy: number }[]; guards?: { x: number; y: number; face: number[] }[]; gate?: { name: string; solid: Rect; slide: number } }

/** The compounds standing in the town: the model's root, its plot (x across, y from the gate at
 * the front, -y, to the back), the plot's middle (y), its walls and places. */
export const COMPOUNDS_BUILT = {
  home: { kind: 'house', w: 24.4, d: 22.4, cy: -3, plan: (plans as unknown as Record<string, CompoundPlan>).house! },
  health: { kind: 'health', w: 28.3, d: 25.7, cy: -3.7, plan: (plans as unknown as Record<string, CompoundPlan>).health! },
} as const

/** Whether the Ministry's gate is open (its guards have let the player in), this visit. */
export const gates = { health: false }
