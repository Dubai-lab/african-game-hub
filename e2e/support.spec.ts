// "Report a problem", through the hosted development project: a player writes a report from
// Settings, is told it has arrived and when to expect an answer, sees it in their list, and
// the two emails (the answer to the player, the notice to our team) are waiting to be sent.
import { expect, test } from '@playwright/test'
import { runSql } from '../scripts/lib/managementApi.ts'
import { ensureTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

const account = TEST_ACCOUNTS[4]
const theirs = `(select id from auth.users where email = '${account.email}')`
const clear = () =>
  runSql(`delete from private.mail_outbox where to_email = '${account.email}' or reply_to = '${account.email}';
          delete from public.support_requests where user_id = ${theirs};`)

test.beforeAll(ensureTestAccounts)
test.beforeEach(clear)
test.afterAll(clear)

test('a player reports a problem from Settings and is told what happens next', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/login')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByTestId('game-chess')).toBeVisible({ timeout: 20_000 })

  await page.goto('/settings')
  await page.getByTestId('settings-support').click()
  await expect(page).toHaveURL(/\/support$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Report a problem' })).toBeVisible()
  await expect(page.getByText('You have not sent any reports.')).toBeVisible()
  await expect(page.getByText(`We will reply to ${account.email}.`)).toBeVisible()

  // Too little to act on: said at once, and nothing is sent.
  await page.getByLabel('What happened?').fill('help')
  await page.getByRole('button', { name: 'Send report' }).click()
  await expect(page.getByText('Please write at least 10 characters.')).toBeVisible()

  await page.getByText('Tokens', { exact: true }).click()
  await page.getByLabel('What happened?').fill('My tokens did not come back after a game was called off.')
  await page.getByRole('button', { name: 'Send report' }).click()

  const sent = page.getByTestId('support-sent')
  await expect(sent).toBeVisible({ timeout: 20_000 })
  await expect(sent).toContainText('within 2 to 3 working days')
  await expect(sent).toContainText(account.email)
  await expect(page.getByTestId('support-list')).toContainText('Tokens')
  await expect(page.getByTestId('support-list')).toContainText('Open')

  const [request] = await runSql<{ id: number; category: string; status: string; page: string | null }>(`select id, category, status, page from public.support_requests where user_id = ${theirs}`)
  expect(request).toMatchObject({ category: 'tokens', status: 'open' })
  await expect(sent).toContainText(`number ${request!.id}`)
  // Both emails were written to the queue in the same step as the report (they may already have gone).
  const mails = await runSql<{ template: string; to_email: string; reply_to: string | null }>(
    `select template, to_email, reply_to from private.mail_outbox where (data ->> 'reference')::bigint = ${request!.id} order by id`,
  )
  expect(mails).toEqual([
    { template: 'support_received', to_email: account.email, reply_to: null },
    { template: 'support_notice', to_email: 'support@africangamehub.com', reply_to: account.email },
  ])
  expect(errors).toEqual([])
})
