// One Africa Life: the rules shared by the server and the app. The clock, the places a life can
// start, the money, and what a character may look like (checked on the server before a life is
// started: the app only offers these choices).
//
// No library: this file is read both by the Edge Functions (Deno) and by the app.

// ---- The clock -----------------------------------------------------------------------------

/**
 * The game's clock runs thirty times faster than real time: a game day is 48 real minutes, so
 * the 90 days a Liberian may stay in Ghana without a visa are about 3 real days. It started at
 * the same moment as the real calendar (the database has the same numbers: oal_settings).
 */
export const CLOCK = { speed: 30, epoch: Date.UTC(2026, 9, 18) } as const

/** The game's date and time at a real moment (milliseconds), as a Date in UTC. */
export function gameTime(realMs: number): Date {
  return new Date(CLOCK.epoch + (realMs - CLOCK.epoch) * CLOCK.speed)
}

/** Real milliseconds that a stretch of game time takes. */
export const realMsFor = (gameMs: number) => gameMs / CLOCK.speed

// ---- Where a life can start --------------------------------------------------------------

export const HOME_TOWNS = {
  LR: ['Monrovia', 'Voinjama'],
  GH: ['Accra', 'Kumasi'],
} as const
export type HomeCountry = keyof typeof HOME_TOWNS

/** A character is an adult, 18 to 60 years old when the life starts. */
export const AGE = { min: 18, max: 60 } as const

// ---- What a character may look like --------------------------------------------------------

export type Sex = 'male' | 'female'

/** Body and face, each from -1 to 1 (0 is average). The belly, hips, bum and bust came later: an
 * appearance made before them has them average. */
export const BUILD = ['weight', 'muscle', 'height', 'belly', 'hips', 'bum', 'bust'] as const
const LATER_BUILD: readonly string[] = ['belly', 'hips', 'bum', 'bust']
export const FACE = ['noseWidth', 'noseLength', 'lips', 'mouthWidth', 'jaw', 'chin', 'cheekbones', 'eyes'] as const

/** The catalogue: every choice the creator offers, by sex. More are added here as they are made. */
export const CATALOGUE = {
  hair: {
    male: ['lowcut', 'short', 'afro', 'bald'],
    female: ['bun', 'afro', 'braids', 'short', 'headtie'],
  },
  hairColour: ['black', 'darkbrown', 'brown', 'auburn'],
  eyes: ['darkbrown', 'brown', 'hazel'],
  outfit: {
    male: ['tee_jeans', 'shirt_jeans', 'jacket_jeans', 'suit', 'overalls', 'striped_shirt'],
    female: ['blouse_skirt', 'tee_jeans', 'tee_shorts', 'sport', 'ankara_dress', 'lappa'],
  },
} as const

export type Appearance = {
  version: 1
  sex: Sex
  /** Skin tone, from the lightest (0) to the darkest (1) of the African skins. */
  skin: number
  build: Record<'weight' | 'muscle' | 'height', number> & Partial<Record<'belly' | 'hips' | 'bum' | 'bust', number>>
  face: Record<(typeof FACE)[number], number>
  hair: string
  hairColour: string
  eyes: string
  outfit: string
}

const inRange = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
const round = (value: number) => Math.round(value * 1000) / 1000

/** The appearance, cleaned up, or null when it is not one the creator could have made. */
export function checkAppearance(input: unknown): Appearance | null {
  if (typeof input !== 'object' || input === null) return null
  const a = input as Record<string, unknown>
  if (a.version !== 1 || (a.sex !== 'male' && a.sex !== 'female') || !inRange(a.skin, 0, 1)) return null
  const sex = a.sex
  const numbers = (group: unknown, names: readonly string[]) => {
    if (typeof group !== 'object' || group === null) return null
    const g = group as Record<string, unknown>
    if (Object.keys(g).some((k) => !names.includes(k))) return null
    const out: Record<string, number> = {}
    for (const name of names) {
      if (g[name] === undefined && LATER_BUILD.includes(name)) {
        out[name] = 0
        continue
      }
      if (!inRange(g[name], -1, 1)) return null
      out[name] = round(g[name] as number)
    }
    return out
  }
  const build = numbers(a.build, BUILD)
  const face = numbers(a.face, FACE)
  if (!build || !face) return null
  const pick = (value: unknown, list: readonly string[]) => (typeof value === 'string' && list.includes(value) ? value : null)
  const hair = pick(a.hair, CATALOGUE.hair[sex])
  const hairColour = pick(a.hairColour, CATALOGUE.hairColour)
  const eyes = pick(a.eyes, CATALOGUE.eyes)
  const outfit = pick(a.outfit, CATALOGUE.outfit[sex])
  if (!hair || !hairColour || !eyes || !outfit) return null
  return { version: 1, sex, skin: round(a.skin), build: build as Appearance['build'], face: face as Appearance['face'], hair, hairColour, eyes, outfit }
}

/** An average-looking character of that sex, where the creator starts. */
export function defaultAppearance(sex: Sex): Appearance {
  return {
    version: 1,
    sex,
    skin: 0.7,
    build: { weight: 0, muscle: 0, height: 0, belly: 0, hips: 0, bum: 0, bust: 0 },
    face: { noseWidth: 0, noseLength: 0, lips: 0, mouthWidth: 0, jaw: 0, chin: 0, cheekbones: 0, eyes: 0 },
    hair: CATALOGUE.hair[sex][0],
    hairColour: 'black',
    eyes: 'darkbrown',
    outfit: CATALOGUE.outfit[sex][0],
  }
}

/** A game name: letters, spaces, apostrophes, dots and hyphens, 2 to 40 characters. Names may repeat. */
export function checkGameName(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const name = input.trim().replace(/\s+/g, ' ')
  return name.length >= 2 && name.length <= 40 && /^[\p{L}][\p{L} .'-]*$/u.test(name) ? name : null
}
