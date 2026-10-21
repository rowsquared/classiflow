import { defineConfig, devices } from '@playwright/test'

// Browser journeys against a production build (`npm run build` first) and a
// disposable database. See tests/e2e/README.md.
const PORT = Number(process.env.E2E_PORT || 3200)
const baseURL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `${baseURL}/api/health`,
    timeout: 60_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: process.env.E2E_DATABASE_URL || '',
      BETTER_AUTH_SECRET: 'e2e-only-not-a-real-secret-0123456789',
      BETTER_AUTH_URL: baseURL,
      // The journeys sign in more often than a person would.
      SIGN_IN_RATE_LIMIT: '1000'
    }
  }
})
