// The bell, through the hosted development project: what the hub has to tell a player shows
// on the bell with a count, a new one arrives while the app is open, opening the list and
// closing it marks them read, and the player can switch the news emails off in Settings.
import { expect, test } from '@playwright/test'
import { runSql } from '../scripts/lib/managementApi.ts'
import { ensureTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

const account = TEST_ACCOUNTS[5]
const theirs = `(select id from auth.users where email = '${account.email}')`
const clear = () =>
  runSql(`delete from public.notifications where user_id = ${theirs};
          update public.profile_private set news_emails = true where user_id = ${theirs};`)
const tell = (kind: string, data: Record<string, unknown>) =>
  runSql(`insert into public.notifications (user_id, kind, data, pushed_at) values (${theirs}, '${kind}', '${JSON.stringify(data).replace(/'/g, "''")}'::jsonb, now())`)

test.beforeAll(ensureTestAccounts)
test.beforeEach(clear)
test.afterAll(clear)

test('the bell counts what is new, shows it in words, and marks it read once seen', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await tell('friend_request', { username: 'amina_k' })
  await tell('announcement', { title: 'A new game on the hub', body: 'Word Battle is here.\nCome and play.' })

  await page.goto('/login')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByTestId('game-chess')).toBeVisible({ timeout: 20_000 })

  const bell = page.getByTestId('notification-bell').filter({ visible: true })
  await expect(bell).toHaveAttribute('data-unread', '2', { timeout: 15_000 })
  await expect(bell).toHaveAccessibleName('Notifications: 2 new')

  // One more arrives while the app is open: nothing to reload.
  await tell('support_answered', { reference: 12 })
  await expect(bell).toHaveAttribute('data-unread', '3', { timeout: 20_000 })

  await bell.click()
  const panel = page.getByTestId('notification-panel')
  await expect(panel.getByRole('heading', { name: 'Notifications' })).toBeVisible()
  await expect(panel.getByText('amina_k wants to be your friend.')).toBeVisible()
  await expect(panel.getByText('A new game on the hub')).toBeVisible()
  await expect(panel.getByText('Word Battle is here.')).toBeVisible()
  await expect(panel.getByText('We have answered your report number 12. The answer is in your email.')).toBeVisible()
  // The newest is first.
  await expect(panel.locator('li').first()).toHaveAttribute('data-kind', 'support_answered')

  await panel.getByRole('button', { name: 'Close' }).click()
  await expect(panel).toBeHidden()
  await expect(bell).toHaveAttribute('data-unread', '0', { timeout: 15_000 })
  const [left] = await runSql<{ unread: number }>(`select count(*)::int as unread from public.notifications where user_id = ${theirs} and read_at is null`)
  expect(left!.unread).toBe(0)

  // A notification about a friend leads to the friends page.
  await bell.click()
  await panel.getByText('amina_k wants to be your friend.').click()
  await expect(page).toHaveURL(/\/friends$/)
  expect(errors).toEqual([])
})

test('a player switches the hub’s news emails off in Settings', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByTestId('game-chess')).toBeVisible({ timeout: 20_000 })

  await page.goto('/settings')
  const news = page.getByTestId('notification-settings').getByLabel('News by email')
  await expect(news).toBeChecked()
  await news.uncheck()
  await expect
    .poll(async () => (await runSql<{ news_emails: boolean }>(`select news_emails from public.profile_private where user_id = ${theirs}`))[0]!.news_emails, { timeout: 15_000 })
    .toBe(false)
  await page.reload()
  await expect(page.getByTestId('notification-settings').getByLabel('News by email')).not.toBeChecked()
})
