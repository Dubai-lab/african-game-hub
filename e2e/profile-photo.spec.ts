// A profile photo: chosen from the device, made small before it is sent, shown to other players,
// and removable. And the username check on the sign-up form.
import { expect, test } from '@playwright/test'
import { runSql } from '../scripts/lib/managementApi.ts'
import { ensureTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

const owner = TEST_ACCOUNTS[4]!
const visitor = TEST_ACCOUNTS[3]!

test.beforeAll(ensureTestAccounts)

async function logIn(page: import('@playwright/test').Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(/\/lobby$/, { timeout: 20_000 })
}

test('a player adds a photo from their device, others see it, and it can be removed', async ({ page, browser }) => {
  await logIn(page, owner.email)
  await page.goto('/profile')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  // Start from no photo, whatever an earlier run left behind.
  if (await page.getByRole('button', { name: 'Remove photo' }).count()) {
    await page.getByRole('button', { name: 'Remove photo' }).click()
    await expect(page.getByRole('button', { name: 'Add a photo' })).toBeVisible({ timeout: 15_000 })
  }
  await expect(page.getByTestId('avatar-photo')).toHaveCount(0)

  // Something that is not a picture is refused, and nothing is sent.
  await page.getByTestId('photo-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a picture') })
  await expect(page.getByText('That file is not a picture. Choose a photo.')).toBeVisible()
  await expect(page.getByTestId('avatar-photo')).toHaveCount(0)

  // A real picture (the app's own icon, 512 pixels square).
  await page.getByTestId('photo-input').setInputFiles('public/icon-512.png')
  await expect(page.getByText('Your photo has been saved.')).toBeVisible({ timeout: 20_000 })
  const photo = page.getByTestId('avatar-photo').first()
  await expect(photo).toBeVisible()
  const address = (await photo.getAttribute('src'))!
  expect(address).toMatch(/\/storage\/v1\/object\/public\/avatars\/[0-9a-f-]{36}\/photo-\d+\.(webp|jpg)$/)
  // What was stored is the small square, not the file that was chosen.
  const stored = await page.request.get(address)
  expect(stored.ok()).toBe(true)
  expect((await stored.body()).length).toBeLessThan(60_000)
  expect(await photo.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([256, 256])

  // It is still there after a refresh, and another player sees it on this player's profile.
  await page.reload()
  await expect(page.getByTestId('avatar-photo').first()).toHaveAttribute('src', address, { timeout: 20_000 })
  const other = await browser.newContext({ locale: 'en-US' })
  const theirs = await other.newPage()
  await logIn(theirs, visitor.email)
  await theirs.goto(`/players/${owner.username}`)
  await expect(theirs.getByTestId('avatar-photo').first()).toHaveAttribute('src', address, { timeout: 20_000 })
  // A visitor is not offered the owner's controls.
  await expect(theirs.getByRole('button', { name: 'Change photo' })).toHaveCount(0)
  await other.close()

  // Changing it stores a new file and forgets the old one.
  await page.getByTestId('photo-input').setInputFiles('public/icon-192.png')
  await expect(page.getByTestId('avatar-photo').first()).not.toHaveAttribute('src', address, { timeout: 20_000 })
  // The old file is deleted from storage. (Its address may still answer for a while from a
  // copy held along the way, so storage itself is asked.)
  const files = () =>
    runSql<{ name: string }>(
      `select o.name from storage.objects o join public.profiles p on o.name like p.id::text || '/%' where o.bucket_id = 'avatars' and p.username = '${owner.username}'`,
    )
  await expect.poll(async () => (await files()).length, { timeout: 20_000 }).toBe(1)
  expect(address).not.toContain((await files())[0]!.name)

  // Removing it brings back the letter.
  await page.getByRole('button', { name: 'Remove photo' }).click()
  await expect(page.getByTestId('avatar-photo')).toHaveCount(0, { timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Add a photo' })).toBeVisible()
  await expect.poll(async () => (await files()).length, { timeout: 20_000 }).toBe(0)
})

test('the sign-up form says whether a username is free while it is being typed', async ({ page }) => {
  await page.goto('/signup')
  const username = page.getByRole('textbox', { name: 'Username' })
  // A name another player holds, whatever the capitals: said at once, before anything is sent.
  await username.fill(owner.username.toUpperCase())
  await expect(page.getByText('This username is taken. Choose another one.')).toBeVisible({ timeout: 10_000 })
  await expect(username).toHaveAttribute('aria-invalid', 'true')

  // A free name.
  const free = `free_${Date.now().toString(36)}`
  await username.fill(free)
  await expect(page.getByText(`@${free} is free.`)).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('This username is taken. Choose another one.')).toHaveCount(0)

  // Back to the taken name and straight to the button: the form refuses, says why at the top,
  // and takes the player to the field.
  await username.fill(owner.username)
  await expect(page.getByText('This username is taken. Choose another one.')).toBeVisible({ timeout: 10_000 })
  await page.getByLabel('Country').selectOption('RW')
  await page.getByLabel('Email').fill('someone-new@example.com')
  await page.getByLabel('Password', { exact: true }).fill('a-long-enough-password')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText('This username is taken. Choose another one.').first()).toBeVisible()
  await expect(username).toBeFocused()
  await expect(page).toHaveURL(/\/signup$/)
})
