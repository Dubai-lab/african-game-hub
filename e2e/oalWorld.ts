// One Africa Life tests: going somewhere in town by the game's map (./src/games/oal/World.tsx).
import type { Page } from '@playwright/test'

/** Opens the map and goes to a place: area (home, sinkor, waterside, town, jobs, visa, airport)
 * and the place in it (home, jobs, visa, airport, or a street's: cookshop, phone, changer...). */
export async function goTo(page: Page, area: string, place: string) {
  await page.getByTestId('oal-map').click({ timeout: 20_000 })
  await page.getByTestId(`oal-map-${area}-${place}`).click()
}
