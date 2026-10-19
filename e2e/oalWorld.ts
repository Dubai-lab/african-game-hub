// One Africa Life tests: going somewhere in town by the game's map (./src/games/oal/World.tsx),
// through its list of places (the map itself is a drawing to drag and pinch).
import type { Page } from '@playwright/test'

async function openList(page: Page) {
  await page.getByTestId('oal-map').click({ timeout: 20_000 })
  await page.getByTestId('oal-map-list').click()
}

/** Goes to a place: area (home, sinkor, waterside, town, jobs, visa, airport) and the place in
 * it (home, jobs, visa, airport, or a street's: cookshop, phone, changer...). */
export async function goTo(page: Page, area: string, place: string) {
  await openList(page)
  await page.getByTestId(`oal-map-${area}-${place}`).click()
}

/** Walks a street built in 3D (sinkor, waterside), from where it is entered. */
export async function walkIn(page: Page, area: string) {
  await openList(page)
  await page.getByTestId(`oal-map-walk-${area}`).click()
}
