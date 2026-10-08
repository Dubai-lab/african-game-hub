// One-off check that the lobby's balance updates live, with no refresh, when the wallet changes
// on the server. It adds 10 bonus tokens to the fixed test account and takes them back, so the
// account ends where it started (two permanent ledger rows are the only trace).
// Usage: node scripts/checkWalletRealtime.ts
import { chromium, devices } from '@playwright/test'
import { createServer } from 'vite'
import { runSql } from './lib/managementApi.ts'

const email = 'e2e-player@example.com'
const adjust = (amount: number) =>
  runSql(`select private.apply_ledger_entry(
            (select id from auth.users where email = '${email}'), ${amount}, 'bonus', 'adjustment')`)

const server = await createServer({ server: { port: 5196, strictPort: true }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch()
let added = false
try {
  const page = await (await browser.newContext({ ...devices['Pixel 5'], locale: 'en-US' })).newPage()
  await page.goto('http://localhost:5196/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('e2e-Password-123')
  await page.getByRole('button', { name: 'Log in' }).click()
  const bonus = page.getByTestId('balance-bonus')
  await bonus.waitFor()
  await page.waitForTimeout(2500) // let the live channel connect
  const before = await bonus.textContent()

  await adjust(10)
  added = true
  await page.waitForFunction((was) => document.querySelector('[data-testid="balance-bonus"]')?.textContent !== was, before, {
    timeout: 15_000,
  })
  const during = await bonus.textContent()

  await adjust(-10)
  added = false
  await page.waitForFunction((was) => document.querySelector('[data-testid="balance-bonus"]')?.textContent === was, before, {
    timeout: 15_000,
  })
  console.log(`PASS  balance went ${before} -> ${during} -> ${await bonus.textContent()} with no refresh`)
  const problems = await runSql(`select * from public.verify_ledger_integrity()`)
  console.log(problems.length === 0 ? 'PASS  ledger integrity' : `FAIL  ledger integrity ${JSON.stringify(problems)}`)
} finally {
  if (added) await adjust(-10)
  await browser.close()
  await server.close()
}
