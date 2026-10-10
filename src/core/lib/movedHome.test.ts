import { describe, expect, it } from 'vitest'
import { newHomeFor } from './movedHome'

const at = (hostname: string, pathname = '/', search = '', hash = '') => ({ hostname, pathname, search, hash })

describe('the move to the hub’s own domain', () => {
  it('sends the first address on to the same page at the new one', () => {
    expect(newHomeFor(at('d2xirivzgoo9lw.cloudfront.net'))).toBe('https://africangamehub.com/')
    expect(newHomeFor(at('d2xirivzgoo9lw.cloudfront.net', '/play/chess/abc', '?from=lobby', '#moves'))).toBe(
      'https://africangamehub.com/play/chess/abc?from=lobby#moves',
    )
    expect(newHomeFor(at('D2XIRIVZGOO9LW.cloudfront.net', '/lobby'))).toBe('https://africangamehub.com/lobby')
  })

  it('keeps a password-reset link whole', () => {
    expect(newHomeFor(at('d2xirivzgoo9lw.cloudfront.net', '/auth/reset', '?code=123', '#type=recovery'))).toBe(
      'https://africangamehub.com/auth/reset?code=123#type=recovery',
    )
  })

  it('stays put at the new address, on a developer’s computer and anywhere else', () => {
    for (const host of ['africangamehub.com', 'localhost', '127.0.0.1', 'admin.africangamehub.com', 'd2hp5w4slz51xb.cloudfront.net', 'cloudfront.net']) {
      expect(newHomeFor(at(host, '/lobby'))).toBeNull()
    }
  })
})
