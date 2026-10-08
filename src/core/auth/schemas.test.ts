import { describe, expect, it } from 'vitest'
import { authErrorKey } from './errors'
import { fieldErrors, loginSchema, signupSchema } from './schemas'

const valid = { username: 'amina_k', countryCode: 'RW', email: ' Amina@Example.com ', password: 'longenough', isAdult: true }

describe('signupSchema', () => {
  it('accepts a valid signup and normalises the email', () => {
    const result = signupSchema.safeParse(valid)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.email).toBe('amina@example.com')
  })

  it('rejects anyone who has not confirmed they are 18 or older', () => {
    const result = signupSchema.safeParse({ ...valid, isAdult: false })
    expect(result.success).toBe(false)
    if (!result.success) expect(fieldErrors(result.error)).toEqual({ isAdult: 'validation.ageRequired' })
  })

  it('rejects bad usernames, short passwords and bad emails with one key per field', () => {
    const result = signupSchema.safeParse({
      username: 'a b',
      countryCode: '',
      email: 'nope',
      password: 'short',
      isAdult: true,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(fieldErrors(result.error)).toEqual({
        username: 'validation.usernameChars',
        countryCode: 'validation.countryRequired',
        email: 'validation.emailInvalid',
        password: 'validation.passwordTooShort',
      })
    }
  })
})

describe('loginSchema', () => {
  it('requires a password', () => {
    const result = loginSchema.safeParse({ email: 'a@b.co', password: '' })
    expect(result.success).toBe(false)
  })
})

describe('authErrorKey', () => {
  it('maps URL error codes and falls back to a generic message', () => {
    expect(authErrorKey('otp_expired')).toBe('errors.linkExpired')
    expect(authErrorKey('something_new')).toBe('errors.generic')
    expect(authErrorKey(new Error('boom'))).toBe('errors.generic')
  })
})
