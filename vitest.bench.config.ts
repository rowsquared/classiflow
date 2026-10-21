import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Progress and queue benchmarks against a seeded database (scripts/bench/seed-progress.ts).
// Same harness as the integration tests: migrations applied, the app connects as
// the least-privilege runtime role. TEST_DATABASE_URL must end in _test and hold
// the seeded data; the benchmark only reads. See docs/plans/progress-dashboard.md.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['tests/bench/**/*.bench.test.ts'],
    globalSetup: ['tests/integration/global-setup.ts'],
    setupFiles: ['tests/integration/setup.ts'],
    fileParallelism: false,
    testTimeout: 1_800_000
  }
})
