// One Africa Life tests: going somewhere in town by the game's map (./src/games/oal/World.tsx),
// through its list of places (the map itself is a drawing to drag and pinch). Going to another
// part of town asks how: `ride` says (walk, kekeh, taxi; out to the airport, airport).
import type { Page } from '@playwright/test'

// The test browser draws 3D in software: while a scene loads, a click can wait a while.
const SLOW = { timeout: 60_000 }

async function openList(page: Page) {
  await page.getByTestId('oal-map').click(SLOW)
  await page.getByTestId('oal-map-list').click(SLOW)
}

/** Goes to a place: area (home, sinkor, waterside, town, jobs, visa, airport, station) and the
 * place in it (home, jobs, visa, airport, station, or a street's: cookshop, phone, changer...). */
export async function goTo(page: Page, area: string, place: string, ride?: string) {
  await openList(page)
  await page.getByTestId(`oal-map-${area}-${place}`).click(SLOW)
  if (ride) await page.getByTestId(`oal-ride-${ride}`).click(SLOW)
}

/** Walks a street built in 3D (sinkor, waterside), from where it is entered. */
export async function walkIn(page: Page, area: string, ride?: string) {
  await openList(page)
  await page.getByTestId(`oal-map-walk-${area}`).click(SLOW)
  if (ride) await page.getByTestId(`oal-ride-${ride}`).click(SLOW)
}
