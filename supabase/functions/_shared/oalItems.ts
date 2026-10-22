// One Africa Life: the things Furniture City sells (public/oal/items.v1.glb, made by
// scripts/oal/makeItems.py), their names and prices (US dollars, as furniture is priced in
// Monrovia), what one gets back selling one again (half, at once), and how many of a thing a
// home may hold. The server charges and pays these; the game shows them.

export const ITEMS = {
  sofa_set: { name: 'Living room set (2 sofas, 2 armchairs, a coffee table)', price: 1450, dept: 'living' },
  corner_sofa: { name: 'Corner sofa, leather', price: 980, dept: 'living' },
  sofa: { name: 'Three-seat sofa, blue', price: 520, dept: 'living' },
  chandelier: { name: 'Ceiling light', price: 260, dept: 'living' },
  double_bed: { name: 'Double bed with mattress', price: 650, dept: 'bed_bath' },
  modern_bed: { name: 'Modern double bed with mattress', price: 890, dept: 'bed_bath' },
  toilet: { name: 'Toilet', price: 180, dept: 'bed_bath' },
  bathtub: { name: 'Bathtub', price: 420, dept: 'bed_bath' },
  sink: { name: 'Hand basin', price: 120, dept: 'bed_bath' },
  kitchen_counter: { name: 'Kitchen counter with sink', price: 1150, dept: 'kitchen' },
} as const

export type ItemId = keyof typeof ITEMS
export const ITEM_IDS = Object.keys(ITEMS) as ItemId[]

/** What a thing fetches sold again (any buyer, at once): half its price. */
export const resale = (id: ItemId) => Math.floor(ITEMS[id].price / 2)

/** The most things one home holds (a home is not a warehouse). */
export const MAX_THINGS = 60
