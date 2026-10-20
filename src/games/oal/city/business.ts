// One Africa Life: which inside (./HomeScene.tsx's kinds, scripts/oal/makeInteriors.py) each kind
// of the town's places opens into, and how a business at a door is told about (a place's name on
// the street: "biz:" its category, its door, the way into it, its name).
/** The insides of the town's places, one for each kind (scripts/oal/makeInteriors.py). */
export const BUSINESS_KINDS = ['provisions', 'restaurant', 'bar', 'salon', 'pharmacy', 'clinic', 'bank', 'office', 'classroom', 'church', 'mosque', 'hotel', 'market', 'hardware', 'boutique'] as const
export type BusinessKind = (typeof BUSINESS_KINDS)[number]

export const INSIDE_OF: Record<string, BusinessKind | 'phoneshop'> = {
  provisions: 'provisions',
  shop: 'provisions',
  food: 'restaurant',
  fun: 'bar',
  video: 'bar',
  salon: 'salon',
  barber: 'salon',
  pharmacy: 'pharmacy',
  health: 'clinic',
  bank: 'bank',
  momo: 'bank',
  government: 'office',
  embassy: 'office',
  office: 'office',
  school: 'classroom',
  church: 'church',
  mosque: 'mosque',
  hotel: 'hotel',
  market: 'market',
  materials: 'hardware',
  parts: 'hardware',
  boutique: 'boutique',
  tailor: 'boutique',
  phones: 'phoneshop',
}

/** A business at its door, as the street names it. */
export type Business = { cat: string; name: string; door: [number, number]; face: [number, number] }

export const businessKey = (b: Business) => `biz:${b.cat}:${b.door[0].toFixed(1)}:${b.door[1].toFixed(1)}:${b.face[0].toFixed(3)}:${b.face[1].toFixed(3)}:${b.name}`

export function businessOf(key: string): Business | null {
  if (!key.startsWith('biz:')) return null
  const [, cat, x, y, fx, fy, ...name] = key.split(':')
  return { cat: cat!, name: name.join(':'), door: [Number(x), Number(y)], face: [Number(fx), Number(fy)] }
}
