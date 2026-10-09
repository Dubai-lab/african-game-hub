import { defineConfig, devices } from '@playwright/test'

// `npm run on-dev -- e2e` runs the tests against the development project: its own copies of the
// two apps are started on their own ports (Vite's "dev" mode reads .env.dev.local), so a site
// already open on the usual ports, pointing at the live project, is left alone.
const onDev = Boolean(process.env.AGH_ENV_FILE)
const playerPort = onDev ? 5273 : 5173
const adminPort = onDev ? 5280 : 5180
const mode = onDev ? ' --mode dev' : ''

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${playerPort}`,
    locale: 'en-US',
    trace: 'retain-on-failure',
  },
  // A mid-range Android viewport: this is what most players use.
  projects: [{ name: 'mobile-chrome', use: { ...devices['Pixel 5'] } }],
  webServer: [
    {
      command: `npm run dev --${mode} --port ${playerPort} --strictPort`,
      url: `http://localhost:${playerPort}`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
    // The admin system is a separate app with its own server (see admin/).
    {
      command: `npm --prefix admin run dev --${mode} --port ${adminPort}`,
      url: `http://localhost:${adminPort}`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
})
