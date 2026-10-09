// The admin system, end to end: a separate app (its own dev server on port 5180) talking to the
// same backend. A test account is made an admin for the length of this file and stripped of it
// afterwards; no account with a known password is ever left holding admin rights.
import { createHmac } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { type Browser, expect, type Page, test } from '@playwright/test'
import { requireEnv, runSql } from '../scripts/lib/managementApi.ts'
import { ensureTestAccounts, resetTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

const ADMIN_APP = process.env.AGH_ENV_FILE ? 'http://localhost:5280' : 'http://localhost:5180'
const ADMIN = TEST_ACCOUNTS[5]
const PLAYER = TEST_ACCOUNTS[0]
const TARGET = TEST_ACCOUNTS[1]

test.setTimeout(180_000)

test.beforeAll(async () => {
  await ensureTestAccounts()
  await resetTestAccounts()
  await runSql(`insert into public.admins (user_id) select id from auth.users where email = '${ADMIN.email}' on conflict do nothing`)
})
// Takes the admin rights and the sign-in factor away again.
test.afterAll(resetTestAccounts)

/** The six-digit code an authenticator app would show for this key right now (RFC 6238). */
function totp(secret: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const char of secret.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(char).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)))
  const digest = createHmac('sha1', key).update(counter).digest()
  const offset = digest[digest.length - 1]! & 0xf
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}

function client() {
  return createClient(requireEnv('VITE_SUPABASE_URL'), requireEnv('VITE_SUPABASE_ANON_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
}

/** Calls the admin API directly, the way an attacker with a stolen password would. */
async function callApi(email: string, action: string, params: Record<string, unknown> = {}) {
  const supabase = client()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: TEST_PASSWORD })
  if (error) throw error
  const response = await fetch(`${requireEnv('VITE_SUPABASE_URL')}/functions/v1/admin-api`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${data.session.access_token}`, apikey: requireEnv('VITE_SUPABASE_ANON_KEY'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, params }),
  })
  return { status: response.status, body: (await response.json()) as { ok: boolean; code?: string } }
}

async function adminPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1366, height: 800 }, locale: 'en-US', baseURL: ADMIN_APP })
  return context.newPage()
}

async function signIn(page: Page, email: string) {
  await page.goto('/')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test('a player account gets nowhere: not in the app, not through the API', async ({ browser }) => {
  const page = await adminPage(browser)
  await signIn(page, PLAYER.email)
  await expect(page.getByRole('alert')).toHaveText('Wrong email or password, or this account has no admin access.')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  // Nothing of the session is kept.
  expect(await page.evaluate(() => window.sessionStorage.getItem('agh.admin.auth'))).toBeNull()

  for (const action of ['overview', 'session', 'players.search', 'audit']) {
    expect(await callApi(PLAYER.email, action), action).toEqual({ status: 403, body: { ok: false, code: 'NOT_ADMIN' } })
  }
  const adjust = await callApi(PLAYER.email, 'players.adjust', { userId: '00000000-0000-0000-0000-000000000000', amount: 100000, balanceType: 'cash', reason: 'free tokens' })
  expect(adjust.body.code).toBe('NOT_ADMIN')
  await page.context().close()
})

test('an admin: password alone is not enough; then reports, a balance correction, a ban, the audit log', async ({ browser }) => {
  // With the right password but without the second step, the API gives nothing away.
  expect(await callApi(ADMIN.email, 'overview')).toEqual({ status: 403, body: { ok: false, code: 'SECOND_STEP_REQUIRED' } })
  expect((await callApi(ADMIN.email, 'players.search')).body.code).toBe('SECOND_STEP_REQUIRED')

  // A player files a report, as they would from the app.
  const player = client()
  await player.auth.signInWithPassword({ email: PLAYER.email, password: TEST_PASSWORD })
  const [target] = await runSql<{ id: string }>(`select id from public.profiles where username = '${TARGET.username}'`)
  const report = await player.rpc('report_player', { p_user_id: target!.id, p_reason: 'abuse', p_note: 'Called me names all game', p_match_id: null })
  expect(report.data).toEqual({ ok: true })

  const page = await adminPage(browser)
  await signIn(page, ADMIN.email)

  // First sign-in: the authenticator is set up before anything else is shown.
  await expect(page.getByRole('heading', { name: 'Protect this account' })).toBeVisible()
  await page.getByRole('button', { name: 'Set up authenticator' }).click()
  const secret = (await page.getByTestId('totp-secret').textContent())!
  await page.getByLabel('Six-digit code').fill('000000')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('alert')).toContainText('That code is not right')
  // Do not start typing a code that is about to change.
  if (Date.now() % 30_000 > 24_000) await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500)
  await page.getByLabel('Six-digit code').fill(totp(secret))
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Balanced')).toBeVisible()

  // The waiting report, with its way in from the overview.
  await page.getByRole('link', { name: /player report is waiting|player reports are waiting/ }).click()
  await expect(page.getByRole('heading', { name: 'Reports from players' })).toBeVisible()
  await expect(page.getByText('“Called me names all game”')).toBeVisible()
  await expect(page.getByText('Abusive messages')).toBeVisible()
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Dismiss report' }).click()
  await expect(page.getByText('“Called me names all game”')).toHaveCount(0)

  // Find the reported player.
  await page.getByRole('link', { name: 'Players' }).click()
  await page.getByRole('searchbox', { name: 'Find a player' }).fill(TARGET.email)
  await page.getByRole('button', { name: 'Search' }).click()
  await page.getByRole('link', { name: TARGET.username, exact: true }).click()
  await expect(page.getByRole('heading', { name: TARGET.username })).toBeVisible()
  const stat = (label: string) => page.getByText(label, { exact: true }).locator('..')
  await expect(stat('Cash tokens')).toContainText('0')

  // A correction needs a reason, and lands in the ledger.
  await page.getByRole('button', { name: 'Adjust balance' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Tokens').fill('150')
  await dialog.getByLabel('Reason (kept in the audit log)').fill('Refund after a server fault')
  await dialog.getByRole('button', { name: 'Add 150 cash tokens' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(stat('Cash tokens')).toContainText('150')
  await expect(page.getByRole('row').filter({ hasText: 'adjustment' }).first()).toContainText('+150')

  // Taking away more than the player has is refused, and says why.
  await page.getByRole('button', { name: 'Adjust balance' }).click()
  await dialog.getByLabel('Direction').selectOption('remove')
  await dialog.getByLabel('Tokens').fill('99999')
  await dialog.getByLabel('Reason (kept in the audit log)').fill('Clawing back too much')
  await dialog.getByRole('button', { name: /Remove 99,999 cash tokens/ }).click()
  await expect(dialog.getByRole('alert')).toHaveText('The player does not have that many tokens in that balance.')
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  // Ban, then lift it.
  await page.getByRole('button', { name: 'Ban player' }).click()
  await dialog.getByLabel('Reason (kept in the audit log)').fill('Abusive chat, second report')
  await dialog.getByRole('button', { name: 'Ban player' }).click()
  await expect(page.getByText('Abusive chat, second report The player cannot join games')).toBeVisible()
  const banned = await runSql<{ is_banned: boolean }>(`select is_banned from public.profile_private where user_id = '${target!.id}'`)
  expect(banned[0]!.is_banned).toBe(true)
  await page.getByRole('button', { name: 'Lift ban' }).click()
  await dialog.getByLabel('Reason (kept in the audit log)').fill('Appeal accepted')
  await dialog.getByRole('button', { name: 'Lift ban' }).click()
  await expect(page.getByRole('button', { name: 'Ban player' })).toBeVisible()

  // Everything above is on record, newest first.
  await page.getByRole('link', { name: 'Audit log' }).click()
  const rows = page.getByRole('row')
  await expect(rows.nth(1)).toContainText('unban')
  await expect(rows.nth(1)).toContainText('Appeal accepted')
  await expect(rows.nth(2)).toContainText('ban')
  await expect(rows.nth(3)).toContainText('adjust balance')
  await expect(rows.nth(3)).toContainText('+150 cash')
  await expect(rows.nth(4)).toContainText('report dismissed')

  // The other pages open.
  await page.getByRole('link', { name: 'Matches' }).click()
  await expect(page.getByRole('heading', { name: 'Matches' })).toBeVisible()
  await expect(page.getByText(/matches, newest first/)).toBeVisible()
  await page.getByRole('link', { name: 'Revenue' }).click()
  await expect(page.getByText('By day')).toBeVisible()
  await page.getByRole('link', { name: 'Integrity' }).click()
  await expect(page.getByText('The books balance. No problems found just now.')).toBeVisible()

  // A reload keeps the admin signed in (same tab); signing out ends it.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Ledger integrity' })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  expect(await page.evaluate(() => window.sessionStorage.getItem('agh.admin.auth'))).toBeNull()
  await page.context().close()
})
