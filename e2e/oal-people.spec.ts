// One Africa Life: the people (public/oal/creator-<sex>.v7.glb, scripts/oal/makeCreatorAssets.py
// and peopleKit.py): the creator's new body sliders (belly, hips, bum, chest, a wider height),
// hair (a low cut, box braids, a head-tie) and clothes (overalls, a striped shirt, an ankara
// dress, a lappa and top, with slippers), each seen on a body of its own.
// Run with: npm run on-dev -- e2e -- e2e/oal-people.spec.ts (SHOTS=<dir> for pictures)
import { expect, type Page, test } from '@playwright/test'
import { ensureTestAccounts, resetTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

test.setTimeout(300_000)
test.beforeAll(ensureTestAccounts)
test.beforeEach(resetTestAccounts)

const shot = async (page: Page, name: string) => {
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` })
}

test('the creator: bodies, hair and clothes of every kind', async ({ page }) => {
  const account = TEST_ACCOUNTS[1]!
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/login')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(/\/lobby$/, { timeout: 20_000 })
  await page.goto('/life')
  await expect(page.getByTestId('oal-creator')).toBeVisible({ timeout: 60_000 })
  const tab = (name: string) => page.getByRole('tab', { name }).click()
  const slide = (label: string, value: number) => page.getByLabel(label, { exact: true }).fill(String(value))
  const pick = (name: string) => page.getByRole('button', { name, exact: true }).click()
  const look = async (name: string) => {
    await page.waitForTimeout(2500)
    await shot(page, name)
  }

  // A curvy woman: big hips and bum, an ankara dress, box braids.
  await pick('Woman')
  await tab('Body')
  for (const label of ['Weight', 'Muscle', 'Height', 'Belly', 'Hips', 'Bum', 'Chest']) await expect(page.getByLabel(label, { exact: true })).toBeVisible()
  await slide('Weight', 0.3)
  await slide('Hips', 1)
  await slide('Bum', 1)
  await slide('Chest', 0.5)
  await tab('Clothes')
  await pick('Ankara dress')
  await tab('Hair')
  await pick('Box braids')
  await tab('Clothes')
  await look('people-1-ankara-braids')
  // A market woman: short and big, a lappa and top, a head-tie.
  await tab('Body')
  await slide('Weight', 1)
  await slide('Height', -1)
  await slide('Belly', 0.7)
  await tab('Clothes')
  await pick('Lappa and top')
  await tab('Hair')
  await pick('Head-tie')
  await tab('Clothes')
  await look('people-2-lappa-headtie')
  // A man: tall, a big belly, overalls, a low cut.
  await pick('Man')
  await tab('Body')
  await slide('Weight', 0.8)
  await slide('Belly', 1)
  await slide('Height', 1)
  await tab('Clothes')
  await pick('Overalls')
  await tab('Hair')
  await pick('Low cut')
  await look('people-3-overalls-lowcut')
  // A slim one in a striped shirt.
  await tab('Body')
  await slide('Weight', -0.8)
  await slide('Belly', -0.5)
  await slide('Muscle', -0.4)
  await tab('Clothes')
  await pick('Striped shirt and jeans')
  await look('people-4-striped-slim')
  expect(errors).toEqual([])
})
