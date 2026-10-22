// One Africa Life's smoothness measured: the city walked through (and driven) on a slowed
// processor (four times slower, as a budget phone is), the frames a second counted, the long
// stalls counted, and where the time goes (a profile of the page's code, its costliest parts).
// Run with: npm run on-dev -- e2e -- e2e/oal-perf.spec.ts --headed (PERF_CPU=<slowdown>)
import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { runSql } from '../scripts/lib/managementApi.ts'
import { ensureTestAccounts, resetTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

test.setTimeout(900_000)
test.beforeAll(ensureTestAccounts)
test.beforeEach(resetTestAccounts)
const APPEARANCE = { version: 1, sex: 'male', skin: 0.7, build: { weight: 0.1, muscle: 0.2, height: 0 }, face: { noseWidth: 0, noseLength: 0, lips: 0, mouthWidth: 0, jaw: 0, chin: 0, cheekbones: 0, eyes: 0 }, hair: 'lowcut', hairColour: 'black', eyes: 'darkbrown', outfit: 'tee_jeans' }

test('smoothness: frames a second in the city, and where the time goes', async ({ page }) => {
  const account = TEST_ACCOUNTS[1]!
  const [me] = await runSql<{ id: string }>(`select id from auth.users where email = '${account.email}'`)
  await runSql(`select public.oal_start_life('${me!.id}', 'Joseph Flomo', 'male', 28, 'LR', 'Monrovia', '${JSON.stringify(APPEARANCE)}'::jsonb)`)
  await page.goto('/login')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(/\/lobby$/, { timeout: 20_000 })
  await page.evaluate(([id]) => {
    localStorage.setItem(`oal-spot:${id}`, JSON.stringify({ area: 'city', place: 'home' }))
    localStorage.setItem('oal-city-hour', '13')
    localStorage.setItem('oal-stats', '1')
  }, [me!.id])
  await page.goto('/life')
  await expect(page.getByTestId('oal-street')).toHaveAttribute('data-x', /\d/, { timeout: 180_000 })
  await expect(page.getByTestId('oal-loading')).toBeHidden({ timeout: 180_000 })
  await page.waitForTimeout(5000)
  console.log('SCENE', JSON.stringify(await page.evaluate(() => {
    type O = { name: string; type: string; matrixAutoUpdate: boolean; matrixWorldAutoUpdate: boolean; children: O[] }
    const sc = (window as unknown as { oalScene: O }).oalScene
    const hub = sc.children.find((c) => c.name.startsWith('hub-'))
    let reach = 0
    const walk = (o: O) => { reach++; for (const c of o.children) if (c.matrixWorldAutoUpdate) walk(c) }
    if (hub) walk(hub)
    return { scene: sc.matrixAutoUpdate, hub: hub && { auto: hub.matrixAutoUpdate, kids: hub.children.map((c) => [c.name || c.type, c.matrixAutoUpdate, c.matrixWorldAutoUpdate, c.children.length]).slice(0, 12), reach } }
  })))
  const cdp = await page.context().newCDPSession(page)
  const slow = Number(process.env.PERF_CPU ?? 4)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: slow })
  // Frames counted, and stalls (a frame longer than 100 ms), from inside the page.
  await page.evaluate(() => {
    const w = window as unknown as { perf: { frames: number; long: number; worst: number; start: number } }
    w.perf = { frames: 0, long: 0, worst: 0, start: performance.now() }
    let last = performance.now()
    const tick = (t: number) => {
      const dt = t - last
      last = t
      w.perf.frames++
      if (dt > 100) w.perf.long++
      w.perf.worst = Math.max(w.perf.worst, dt)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  const before = await page.evaluate(() => ((window as unknown as { oalCityStats?: { programNames?: string[] } }).oalCityStats?.programNames ?? []))
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 1000 })
  await cdp.send('Profiler.start')
  // Walking up the street (the stick held forward), then turning.
  const stick = (await page.locator('[data-stick]').boundingBox())!
  const cx = stick.x + stick.width / 2
  const cy = stick.y + stick.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx, cy - 50, { steps: 4 })
  await page.waitForTimeout(12000)
  await page.mouse.move(cx + 40, cy - 30, { steps: 4 })
  await page.waitForTimeout(8000)
  await page.mouse.up()
  const { profile } = await cdp.send('Profiler.stop')
  const perf = await page.evaluate(() => {
    const p = (window as unknown as { perf: { frames: number; long: number; worst: number; start: number } }).perf
    const secs = (performance.now() - p.start) / 1000
    return { fps: p.frames / secs, long: p.long, worst: Math.round(p.worst), secs: Math.round(secs) }
  })
  const info = await page.evaluate(() => (window as unknown as { oalCityStats?: unknown }).oalCityStats ?? null)
  // Self time by function (and file), the costliest first.
  const self = new Map<number, number>()
  const total = profile.samples?.length ?? 1
  for (const id of profile.samples ?? []) self.set(id, (self.get(id) ?? 0) + 1)
  const byFn = new Map<string, number>()
  for (const n of profile.nodes) {
    const c = n.callFrame
    const key = `${c.functionName || '(anon)'} ${c.url.split('/').pop()?.split('?')[0]}:${c.lineNumber}`
    byFn.set(key, (byFn.get(key) ?? 0) + (self.get(n.id) ?? 0))
  }
  const top = [...byFn].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, n]) => `${((n / total) * 100).toFixed(1)}% ${k}`)
  const after = await page.evaluate(() => ((window as unknown as { oalCityStats?: { programNames?: string[] } }).oalCityStats?.programNames ?? []))
  console.log('PROGRAMS', before.length, '->', after.length)
  const fresh = after.filter((x) => !before.includes(x))
  console.log('NEWPROGS', fresh.length)
  // Each new one beside an older one of the same material: what differs in their keys.
  for (const n of fresh.slice(0, 12)) {
    const [name, key] = n.split('|') as [string, string]
    const old = before.find((b) => b.split('|')[0] === name) ?? after.find((b) => b !== n && b.split('|')[0] === name)
    if (!old) { console.log('NEWPROG', name, '(first of its kind)', key.slice(0, 120)); continue }
    const a = key.split(','); const b = old.split('|')[1]!.split(',')
    const diff = a.map((v, i) => (v !== b[i] ? `${i}:${b[i]}->${v}` : null)).filter(Boolean)
    console.log('NEWPROG', name, 'differs at', diff.slice(0, 8).join(' '))
  }
  const { by, nodes, programNames, tris, updates, ...brief } = (info ?? {}) as Record<string, unknown>
  void by
  void programNames
  console.log('PERF', JSON.stringify({ slow, ...perf, info: brief }))
  console.log('TRIS', JSON.stringify(Object.entries((tris ?? {}) as Record<string, number>).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, n]) => `${k}:${Math.round(n / 1000)}k`)))
  void nodes
  console.log('UPDATES', JSON.stringify(Object.entries((updates ?? {}) as Record<string, number>).sort((a, b) => b[1] - a[1]).slice(0, 25)))
  for (const l of top) console.log('HOT', l)
  if (process.env.SHOTS) writeFileSync(`${process.env.SHOTS}/profile.cpuprofile`, JSON.stringify(profile))
})
