// One Africa Life: two players, against the development project. Each has a life in Monrovia
// with a registered phone. Kollie texts Musu and sends her mobile money; she sees both. Then
// both go out on Tubman Boulevard and each sees the other is out there.
// (The rules: supabase/tests/oalPhoneSocial.test.ts.)
// Run with: npm run on-dev -- e2e -- e2e/oal-together.spec.ts
import { type Browser, expect, type Page, test } from '@playwright/test'
import { runSql } from '../scripts/lib/managementApi.ts'
import { ensureTestAccounts, resetTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

test.setTimeout(1_200_000)
test.beforeAll(ensureTestAccounts)
test.beforeEach(resetTestAccounts)
test.afterAll(resetTestAccounts)

const look = (sex: 'male' | 'female') => ({
  version: 1, sex, skin: 0.8,
  build: { weight: 0.1, muscle: 0.1, height: 0 },
  face: { noseWidth: 0, noseLength: 0, lips: 0, mouthWidth: 0, jaw: 0, chin: 0, cheekbones: 0, eyes: 0 },
  hair: sex === 'male' ? 'lowcut' : 'braids', hairColour: 'black', eyes: 'darkbrown', outfit: sex === 'male' ? 'shirt_jeans' : 'blouse_skirt',
})

/** A life in Monrovia with a phone, a registered Citrus SIM, airtime and money; its number. */
async function lifeWithPhone(index: number, name: string, sex: 'male' | 'female') {
  const account = TEST_ACCOUNTS[index]!
  const [me] = await runSql<{ id: string }>(`select id from auth.users where email = '${account.email}'`)
  const id = me!.id
  await runSql(`select public.oal_start_life('${id}', '${name}', '${sex}', 28, 'LR', 'Monrovia', '${JSON.stringify(look(sex))}'::jsonb)`)
  await runSql(`select private.oal_money('${id}', 'LRD', 1000000, 'adjustment')`)
  await runSql(`select public.oal_home_action('${id}', 'buy_phone', 'lr_basic', null)`)
  await runSql(`select public.oal_home_action('${id}', 'buy_sim', 'lr_citrus', null)`)
  const [reg] = await runSql<{ r: { number: string } }>(`select public.oal_home_action('${id}', 'register_sim', 'lr_citrus', null) as r`)
  await runSql(`select public.oal_home_action('${id}', 'top_up', 'lr_citrus', 10000)`)
  return { account, id, number: reg!.r.number }
}

async function open(browser: Browser, account: { email: string }): Promise<Page> {
  const context = await browser.newContext({ ...test.info().project.use })
  const page = await context.newPage()
  await page.goto('/login')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(/\/lobby$/, { timeout: 30_000 })
  await page.goto('/life')
  await expect(page.getByTestId('oal-phone-use')).toBeVisible({ timeout: 30_000 })
  return page
}

const local = (e164: string) => `0${e164.slice(4, 6)} ${e164.slice(6, 9)} ${e164.slice(9)}`

test('a text and mobile money between two players, and each seen on Tubman Boulevard', async ({ browser }) => {
  const kollie = await lifeWithPhone(0, 'Kollie Flomo', 'male')
  const musu = await lifeWithPhone(1, 'Musu Kollie', 'female')
  const a = await open(browser, kollie.account)
  const b = await open(browser, musu.account)

  // Kollie texts Musu, then puts L$1,000 on his wallet and sends her L$500.
  await a.getByTestId('oal-text-to').fill(local(musu.number))
  await a.getByTestId('oal-text-body').fill('Musu, it is Kollie. I am on Tubman.')
  await a.getByTestId('oal-text-send').click()
  await expect(a.getByText('Sent.')).toBeVisible({ timeout: 20_000 })
  await a.getByTestId('oal-momo-amount').fill('1000')
  await a.getByTestId('oal-cash-in').click()
  await expect(a.getByText('Cashed in.')).toBeVisible({ timeout: 20_000 })
  await a.getByTestId('oal-momo-amount').fill('500')
  await a.getByTestId('oal-momo-to').fill(local(musu.number))
  await a.getByTestId('oal-momo-send').click()
  await expect(a.getByText('Money sent.')).toBeVisible({ timeout: 20_000 })

  // Musu sees the text (within the inbox's refresh) and the money.
  await b.reload()
  await expect(b.getByTestId('oal-inbox')).toContainText('Musu, it is Kollie. I am on Tubman.', { timeout: 30_000 })
  await expect(b.getByTestId('oal-wallet')).toHaveText('L$500', { timeout: 30_000 })

  // Both out on the street: each sees the other.
  await a.getByTestId('oal-go-out').click()
  await b.getByTestId('oal-go-out').click()
  await expect(a.getByTestId('oal-street-chip')).toContainText('1 other person out here', { timeout: 180_000 })
  await expect(b.getByTestId('oal-street-chip')).toContainText('1 other person out here', { timeout: 180_000 })
})
