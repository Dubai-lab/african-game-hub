import { describe, expect, it } from 'vitest'
import { backAction, isNativeApp } from './nativeApp'

describe('inside the phone app', () => {
  it('knows the app from a browser by the name the shell adds', () => {
    expect(isNativeApp('Mozilla/5.0 (Linux; Android 14; Pixel 6) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36 AfricanGameHubApp/1.0')).toBe(true)
    expect(isNativeApp('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 AfricanGameHubApp/1.0')).toBe(true)
    expect(isNativeApp('Mozilla/5.0 (Linux; Android 14; Pixel 6) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36')).toBe(false)
    expect(isNativeApp('NotAfricanGameHubApp')).toBe(false)
  })

  it('Back steps back through the app, and leaves it from the first pages', () => {
    expect(backAction('/wallet', true)).toBe('back')
    expect(backAction('/play/chess/match/abc', true)).toBe('back')
    // The lobby is home: Back there puts the app away, however many pages came before.
    expect(backAction('/lobby', true)).toBe('leave')
    expect(backAction('/lobby/', true)).toBe('leave')
    expect(backAction('/login', true)).toBe('leave')
    expect(backAction('/', true)).toBe('leave')
    // Nothing behind this page: there is nowhere to step back to.
    expect(backAction('/wallet', false)).toBe('leave')
  })
})
