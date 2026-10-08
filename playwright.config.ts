import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    locale: 'en-US',
    trace: 'retain-on-failure',
  },
  // A mid-range Android viewport: this is what most players use.
  projects: [{ name: 'mobile-chrome', use: { ...devices['Pixel 5'] } }],
  webServer: [
    {
      command: 'npm run dev -- --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    // The admin system is a separate app with its own server (see admin/).
    {
      command: 'npm --prefix admin run dev',
      url: 'http://localhost:5180',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
})
