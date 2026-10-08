// Friends, private messages, chat during a match, and premoves: two real browsers and accounts.
import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test'
import { runSql } from '../scripts/lib/managementApi.ts'
import { ensureTestAccounts, resetTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

test.setTimeout(150_000)
test.beforeAll(ensureTestAccounts)
test.beforeEach(resetTestAccounts)
test.afterAll(resetTestAccounts)

type Seat = { context: BrowserContext; page: Page }

async function signedIn(browser: Browser, index: number): Promise<Seat> {
  const context = await browser.newContext({ viewport: { width: 393, height: 851 }, locale: 'en-US', hasTouch: true })
  const page = await context.newPage()
  await page.goto('/login')
  await page.getByLabel('Email').fill(TEST_ACCOUNTS[index]!.email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('button', { name: 'Find match' })).toBeVisible()
  return { context, page }
}

const square = (page: Page, name: string) => page.locator(`[data-square="${name}"]`)
const pieceOn = (page: Page, name: string) => square(page, name).locator('[data-piece]')

test('friends: a request must be accepted before the two can message each other', async ({ browser }) => {
  const amina = await signedIn(browser, 0)
  const bayo = await signedIn(browser, 1)

  // Not friends: there is no way to write to the other player.
  await amina.page.goto('/friends/e2e_player2')
  await expect(amina.page.getByText('You can message a player once they have accepted your friend request.')).toBeVisible()
  await expect(amina.page.getByPlaceholder('Write a message')).toHaveCount(0)

  // Amina asks from Bayo's profile.
  await amina.page.goto('/players/e2e_player2')
  await amina.page.getByRole('button', { name: 'Add friend' }).click()
  await expect(amina.page.getByTestId('friend-actions')).toContainText('Friend request sent')
  // Asked but not yet accepted: still no messaging.
  await amina.page.goto('/friends/e2e_player2')
  await expect(amina.page.getByPlaceholder('Write a message')).toHaveCount(0)

  // Bayo is told (a count on the Friends tab, without refreshing) and accepts.
  await expect(bayo.page.getByTestId('friends-badge').first()).toHaveText('1', { timeout: 20_000 })
  await bayo.page.getByRole('link', { name: /Friends/ }).click()
  await expect(bayo.page.getByTestId('friend-requests')).toContainText('E2E Player')
  await bayo.page.getByRole('button', { name: 'Accept' }).click()
  await expect(bayo.page.getByTestId('friends')).toContainText('E2E Player')

  // Now Amina can write, and Bayo is told at once.
  await amina.page.goto('/friends')
  await expect(amina.page.getByTestId('friends')).toContainText('e2e_player2', { timeout: 20_000 })
  await amina.page.getByRole('link', { name: 'Message' }).click()
  await amina.page.getByPlaceholder('Write a message').fill('Good game earlier. Rematch tonight?')
  await amina.page.getByRole('button', { name: 'Send' }).click()
  await expect(amina.page.getByRole('log')).toContainText('Good game earlier. Rematch tonight?')

  await expect(bayo.page.getByRole('status').filter({ hasText: 'New message from E2E Player' })).toBeVisible({ timeout: 20_000 })
  await expect(bayo.page.getByTestId('friends-badge').first()).toHaveText('1')
  await bayo.page.getByRole('link', { name: 'Message' }).click()
  await expect(bayo.page.getByRole('log')).toContainText('Good game earlier. Rematch tonight?')
  // Opening it clears the unread count.
  await expect(bayo.page.getByTestId('friends-badge')).toHaveCount(0, { timeout: 15_000 })

  // The reply appears on Amina's open conversation without refreshing.
  await bayo.page.getByPlaceholder('Write a message').fill('Yes. Eight o’clock.')
  await bayo.page.getByRole('button', { name: 'Send' }).click()
  await expect(amina.page.getByRole('log')).toContainText('Yes. Eight o’clock.', { timeout: 20_000 })

  // Removing the friend closes the conversation for both.
  await bayo.page.goto('/players/e2e_player')
  await bayo.page.getByRole('button', { name: 'Remove friend' }).click()
  await expect(bayo.page.getByRole('button', { name: 'Add friend' })).toBeVisible()
  await amina.page.getByPlaceholder('Write a message').fill('Still there?')
  await amina.page.getByRole('button', { name: 'Send' }).click()
  await expect(amina.page.getByRole('alert').filter({ hasText: 'You can only message players who have accepted your friend request.' })).toBeVisible()

  await amina.context.close()
  await bayo.context.close()
})

test('during a match: emoji and text between opponents, the off switch, and a premove', async ({ browser }) => {
  const one = await signedIn(browser, 0)
  const two = await signedIn(browser, 1)

  await one.page.getByRole('button', { name: 'Find match' }).click()
  await expect(one.page.getByRole('heading', { name: 'Looking for an opponent…' })).toBeVisible()
  await two.page.getByRole('button', { name: 'Find match' }).click()
  for (const { page } of [one, two]) {
    await expect(page).toHaveURL(/\/play\/chess\/match\//, { timeout: 20_000 })
    await expect(page.getByTestId('chess-board')).toBeVisible()
  }
  const a1 = (await square(one.page, 'a1').boundingBox())!
  const a8 = (await square(one.page, 'a8').boundingBox())!
  const [white, black] = a1.y > a8.y ? [one.page, two.page] : [two.page, one.page]

  // Premove: Black chooses ...e5 while it is still White's turn. Nothing is played yet.
  await square(black, 'e7').click()
  await square(black, 'e5').click()
  await expect(black.getByTestId('chess-board')).toHaveAttribute('data-premove', 'e7e5')
  await expect(pieceOn(black, 'e7')).toHaveCount(1)
  // White moves, and Black's queued reply is played by itself on both boards.
  await square(white, 'e2').click()
  await square(white, 'e4').click()
  await expect(pieceOn(white, 'e5')).toHaveCount(1, { timeout: 20_000 })
  await expect(pieceOn(black, 'e5')).toHaveCount(1)
  await expect(black.getByRole('list', { name: 'Moves' }).getByRole('button')).toHaveText(['e4', 'e5'])

  // The two are not friends, and can still react and talk during the game.
  await expect(white.getByTestId('match-chat')).toHaveAttribute('data-open', 'true')
  await white.getByRole('group', { name: 'Quick reactions' }).getByRole('button', { name: '😂' }).click()
  await expect(black.getByTestId('chat-pop')).toContainText('😂', { timeout: 20_000 })
  await black.getByPlaceholder('Say something').fill('Nice opening!')
  await black.getByTestId('match-chat').getByRole('button', { name: 'Send' }).click()
  await expect(white.getByTestId('chat-pop')).toContainText('Nice opening!', { timeout: 20_000 })
  await expect(white.getByTestId('match-chat').getByRole('log')).toContainText('Nice opening!')

  // Black has had enough and turns live chat off: nothing can be sent either way.
  await black.getByRole('button', { name: 'Turn chat off' }).click()
  await expect(black.getByText('Live chat is off. You are not sending or receiving anything.')).toBeVisible()
  await expect(black.getByRole('group', { name: 'Quick reactions' })).toHaveCount(0)
  // White's app re-reads the chat state every 20 seconds, so it may already know. If it does
  // not, trying to send is refused by the server and tells it. Either way nothing gets through.
  await white.getByRole('group', { name: 'Quick reactions' }).getByRole('button', { name: '😡' }).click({ timeout: 5_000 }).catch(() => undefined)
  await expect(white.getByTestId('match-chat')).toContainText('Your opponent has turned live chat off.', { timeout: 25_000 })
  await expect(black.getByTestId('chat-pop')).toHaveCount(0)

  // The same switch is in Settings, and it is remembered on the account.
  await black.getByRole('link', { name: 'Lobby' }).click()
  await black.getByRole('link', { name: 'Settings' }).click()
  await expect(black.getByRole('checkbox', { name: /Live chat during games/ })).not.toBeChecked()
  await black.getByRole('checkbox', { name: /Live chat during games/ }).check()
  await expect(black.getByRole('checkbox', { name: /Premoves/ })).toBeChecked()

  await one.context.close()
  await two.context.close()
})

test('report and block: the report reaches the admin team, the block closes contact both ways', async ({ browser }) => {
  const amina = await signedIn(browser, 0)
  const bayo = await signedIn(browser, 1)

  await amina.page.goto('/players/e2e_player2')
  await amina.page.getByTestId('safety-actions').getByRole('button', { name: 'Report' }).click()
  const dialog = amina.page.getByRole('dialog', { name: /^Report / })
  await dialog.getByLabel('What happened?').selectOption('cheating')
  await dialog.getByLabel('Anything we should know (optional)').fill('Plays like a machine in every game')
  await dialog.getByLabel('Also block this player').check()
  await dialog.getByRole('button', { name: 'Send report' }).click()
  await expect(amina.page.getByRole('status').filter({ hasText: 'Report sent. Our team will look at it.' })).toBeVisible()
  await expect(dialog).toHaveCount(0)

  // Blocked: the profile says so, and offers no way to befriend.
  await expect(amina.page.getByRole('button', { name: 'Unblock' })).toBeVisible()
  await expect(amina.page.getByText('You have blocked this player.')).toBeVisible()
  await expect(amina.page.getByRole('button', { name: 'Add friend' })).toHaveCount(0)

  // The report is waiting for the admins, and the reported player cannot see it.
  const reports = await runSql<{ reason: string; note: string; status: string }>(
    `select r.reason, r.note, r.status from public.reports r join public.profiles p on p.id = r.reported_id where p.username = 'e2e_player2'`,
  )
  expect(reports).toEqual([{ reason: 'cheating', note: 'Plays like a machine in every game', status: 'open' }])

  // The blocked player is not told they are blocked; contact simply does not work.
  await bayo.page.goto('/players/e2e_player')
  await bayo.page.getByRole('button', { name: 'Add friend' }).click()
  await expect(bayo.page.getByRole('alert').filter({ hasText: 'You cannot contact this player.' })).toBeVisible()

  // Lifting the block restores the normal profile.
  await amina.page.getByRole('button', { name: 'Unblock' }).click()
  await expect(amina.page.getByRole('button', { name: 'Add friend' })).toBeVisible()

  await amina.context.close()
  await bayo.context.close()
})
