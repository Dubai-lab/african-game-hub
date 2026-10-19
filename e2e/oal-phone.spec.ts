// One Africa Life: a phone and a SIM, registered as the law asks, and a room, against the
// development project. A Ghanaian in Accra buys a basic phone and a SIM, registers it with the
// Ghana Card, tops it up, and finds the landlord wants twelve months in advance.
// (The rules, and a host found by their number at the border, are tested on the database:
// supabase/tests/oalHome.test.ts.)
// Run with: npm run on-dev -- e2e -- e2e/oal-phone.spec.ts
import { expect, test } from '@playwright/test'
import { runSql } from '../scripts/lib/managementApi.ts'
import { ensureTestAccounts, resetTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

test.setTimeout(180_000)
test.beforeAll(ensureTestAccounts)
test.beforeEach(resetTestAccounts)
test.afterAll(resetTestAccounts)

const APPEARANCE = {
  version: 1, sex: 'female', skin: 0.8,
  build: { weight: 0.2, muscle: 0, height: 0 },
  face: { noseWidth: 0, noseLength: 0, lips: 0, mouthWidth: 0, jaw: 0, chin: 0, cheekbones: 0, eyes: 0 },
  hair: 'braids', hairColour: 'black', eyes: 'darkbrown', outfit: 'blouse_skirt',
}

test('a Ghanaian in Accra: a phone, a SIM registered with the Ghana Card, airtime, and the landlord\'s advance', async ({ page }) => {
  const account = TEST_ACCOUNTS[2]!
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const [me] = await runSql<{ id: string }>(`select id from auth.users where email = '${account.email}'`)
  await runSql(`select public.oal_start_life('${me!.id}', 'Ama Mensah', 'female', 26, 'GH', 'Accra', '${JSON.stringify(APPEARANCE)}'::jsonb)`)
  const [card] = await runSql<{ number: string }>(`select number from public.oal_id_cards where user_id = '${me!.id}'`)
  expect(card!.number).toMatch(/^GHA-\d{9}-\d$/)

  await page.goto('/login')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(/\/lobby$/, { timeout: 20_000 })
  await page.goto('/life')
  const phone = page.getByTestId('oal-phone')
  await expect(phone).toBeVisible({ timeout: 20_000 })
  await expect(phone.getByText(`Your Ghana Card: ${card!.number}`)).toBeVisible()

  await page.getByTestId('oal-buy-gh_basic').click()
  await expect(phone.getByText('You have a basic phone.')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('oal-buy-sim-gh_sika').click()
  await page.getByTestId('oal-register-gh_sika').click()
  await expect(page.getByText(/Registered\. Your number is 0(24|54|55|59)/)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('oal-number-gh_sika')).toHaveText(/^0(24|54|55|59) \d{3} \d{4}$/)
  const [sim] = await runSql<{ id_kind: string; id_number: string }>(`select id_kind, id_number from public.oal_sims where user_id = '${me!.id}'`)
  expect(sim).toEqual({ id_kind: 'ghana_card', id_number: card!.number })

  await page.getByTestId('oal-network-gh_sika').getByLabel('Airtime to buy').fill('5')
  await page.getByTestId('oal-network-gh_sika').getByRole('button', { name: 'Top up' }).click()
  await expect(page.getByTestId('oal-network-gh_sika').getByText('Airtime GH¢5')).toBeVisible({ timeout: 20_000 })

  // A single room in Nima: GH¢400 a month, twelve months at once. Not yet.
  await expect(page.getByTestId('oal-room').getByText('You live with family for now.')).toBeVisible()
  await page.getByTestId('oal-rent-nima_single').click()
  await expect(page.getByText('You do not have enough money for that.')).toBeVisible({ timeout: 20_000 })
  expect(errors).toEqual([])
})
