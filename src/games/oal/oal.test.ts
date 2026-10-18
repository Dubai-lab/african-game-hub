import { describe, expect, it } from 'vitest'
import { checkAppearance, checkGameName, CLOCK, defaultAppearance, gameTime } from '../../../supabase/functions/_shared/oal'

// One Africa Life's shared rules: what a character may look like, names, and the clock.

describe('a character', () => {
  it('the creator\'s starting character is a valid one, for both sexes', () => {
    for (const sex of ['male', 'female'] as const) expect(checkAppearance(defaultAppearance(sex))).toEqual(defaultAppearance(sex))
  })

  it('refuses anything the creator could not have made', () => {
    const base = defaultAppearance('male')
    for (const bad of [
      { ...base, skin: 2 },
      { ...base, hair: 'braids' },
      { ...base, outfit: 'blouse_skirt' },
      { ...base, build: { ...base.build, weight: 5 } },
      { ...base, face: { ...base.face, extra: 0 } },
      { ...base, version: 2 },
      null,
    ]) expect(checkAppearance(bad)).toBeNull()
  })

  it('names may be any letters, but not numbers or symbols', () => {
    expect(checkGameName('  Musu   Kollie ')).toBe('Musu Kollie')
    expect(checkGameName("Kwame O'Neil-Asante")).toBe("Kwame O'Neil-Asante")
    for (const bad of ['A', 'x'.repeat(41), 'Bob1', '<script>', ' ']) expect(checkGameName(bad)).toBeNull()
  })
})

describe('the clock', () => {
  it('runs thirty times faster: 90 game days in 3 real days', () => {
    const start = CLOCK.epoch + 1000
    const later = start + 3 * 24 * 3600 * 1000
    expect((gameTime(later).getTime() - gameTime(start).getTime()) / (24 * 3600 * 1000)).toBe(90)
  })
})
