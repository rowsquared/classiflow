import { defineConfig, devices } from '@playwright/test'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Browser journeys against a production build (`npm run build` first) and a
// disposable database. See tests/e2e/README.md.
const PORT = Number(process.env.E2E_PORT || 3200)
const baseURL = `http://localhost:${PORT}`
// The journeys' stand-in for the n8n mail workflow (tests/e2e/mail.spec.ts).
const MAIL_PORT = PORT + 1

export default defineConfig({
  testDir: 'tests/e2e',
  // Downloads in a Windows Desktop checkout can stay locked. Keep each
  // checkout's temporary artifacts separate, including concurrent worktrees.
  outputDir:
    process.platform === 'win32'
      ? join(tmpdir(), 'classiflow-e2e', createHash('sha256').update(process.cwd()).digest('hex').slice(0, 12))
      : 'test-results',
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
      SIGN_IN_RATE_LIMIT: '1000',
      // AI can be configured (tests/e2e/ai-settings.spec.ts); no service runs.
      AI_SOURCE_SLUG: 'ai',
      AI_CREDENTIALS_KEYS: 'e2e:MlYB0Tmfes0OCnkWHxv/4MwbwWkWUTFZAj7YUvaDDcg=',
      // Mail on, sent to the journeys' local webhook.
      N8N_EMAIL_WEBHOOK_SECRET: 'e2e-only-mail-secret',
      N8N_EMAIL_WEBHOOK_URL: `http://127.0.0.1:${MAIL_PORT}/webhook/send-email`,
      APP_BASE_URL: baseURL
    }
  }
})
