import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import en from '@/core/i18n/locales/en.json'
import fr from '@/core/i18n/locales/fr.json'
import { EMOJI, QUICK_BY_GAME, QUICK_MESSAGES, quickFor } from './quickMessages'

// The server refuses anything it does not list, so the app and the server must list the same.
const sql = readFileSync('supabase/migrations/20261011100000_quick_chat.sql', 'utf8')
const listed = (name: string) => {
  const from = sql.indexOf(`${name} constant text[] := array[`)
  if (from < 0) throw new Error(`${name} is not in the migration`)
  return [...sql.slice(from, sql.indexOf('];', from)).matchAll(/'([^']+)'/g)].map((m) => m[1]!)
}

describe('quick messages and reactions', () => {
  it('the app offers exactly the reactions the server accepts', () => {
    expect([...EMOJI].sort()).toEqual(listed('v_emoji').sort())
    expect(new Set(EMOJI).size).toBe(EMOJI.length)
  })

  it('the app offers exactly the ready-made messages the server accepts', () => {
    expect([...QUICK_MESSAGES].sort()).toEqual(listed('v_quick').sort())
  })

  it('every ready-made message has its words in every language', () => {
    for (const name of QUICK_MESSAGES) {
      expect((en.chat.quick as Record<string, string>)[name], `English for ${name}`).toBeTruthy()
      expect((fr.chat.quick as Record<string, string>)[name], `French for ${name}`).toBeTruthy()
    }
  })

  it('each game offers its own messages with the common ones, none twice', () => {
    for (const game of [...Object.keys(QUICK_BY_GAME), 'a-game-not-yet-made']) {
      const offered = quickFor(game)
      expect(new Set(offered).size).toBe(offered.length)
      expect(offered.slice(0, 2)).toEqual(['hello', 'good_luck'])
      for (const own of QUICK_BY_GAME[game] ?? []) expect(offered).toContain(own)
      expect(offered).toContain('good_game')
    }
    expect(quickFor('pool')).toContain('nice_shot')
    expect(quickFor('chess')).not.toContain('nice_shot')
  })
})
