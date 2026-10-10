import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './testDb'

// A profile's photo address may only point at that player's own folder in the photo bucket.

let db: TestDb
let amina: string
let kofi: string
const mine = (id: string, file = 'photo-1.webp') => `https://abcdefgh.supabase.co/storage/v1/object/public/avatars/${id}/${file}`
const setAs = (who: string, id: string, url: string | null) =>
  db.as('authenticated', who, () => db.rows<{ avatar_url: string | null }>(`update public.profiles set avatar_url = $2 where id = $1 returning avatar_url`, [id, url]))

beforeAll(async () => {
  db = await createTestDb()
  amina = await db.createUser('amina-photo@example.com', { username: 'amina_photo', country_code: 'KE', age_confirmed: true })
  kofi = await db.createUser('kofi-photo@example.com', { username: 'kofi_photo', country_code: 'GH', age_confirmed: true })
}, 120_000)
afterAll(async () => {
  await db.close()
})

describe('profile photos', () => {
  it('a player can set, change and remove their own photo', async () => {
    expect(await setAs(amina, amina, mine(amina))).toEqual([{ avatar_url: mine(amina) }])
    expect(await setAs(amina, amina, mine(amina, 'photo-2.jpg'))).toEqual([{ avatar_url: mine(amina, 'photo-2.jpg') }])
    expect(await setAs(amina, amina, null)).toEqual([{ avatar_url: null }])
  })

  it('the address must be a picture in the player’s own folder of the photo bucket, and nowhere else', async () => {
    for (const url of [
      'https://evil.example/tracker.png',
      `https://evil.example/storage/v1/object/public/avatars/${amina}/photo-1.webp`,
      mine(kofi),
      `https://abcdefgh.supabase.co/storage/v1/object/public/other-bucket/${amina}/photo-1.webp`,
      `${mine(amina)}?redirect=https://evil.example`,
      `https://abcdefgh.supabase.co/storage/v1/object/public/avatars/${amina}/../${kofi}/photo-1.webp`,
      mine(amina, 'photo-1.svg'),
      'javascript:alert(1)',
    ]) {
      await expect(setAs(amina, amina, url), url).rejects.toThrow(/AVATAR_URL_NOT_ALLOWED/)
    }
  })

  it('nobody can set another player’s photo', async () => {
    // The update simply finds no row it is allowed to change.
    expect(await setAs(amina, kofi, mine(kofi))).toEqual([])
    expect((await db.rows<{ avatar_url: string | null }>(`select avatar_url from public.profiles where id = $1`, [kofi]))[0]!.avatar_url).toBeNull()
  })
})
