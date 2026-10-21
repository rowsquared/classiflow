import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Route-handler tests against a real PostgreSQL database. See tests/integration/README.md.
export default defineConfig({
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./', import.meta.url)),
		},
	},
	test: {
		environment: 'node',
		include: ['tests/integration/**/*.test.ts'],
		globalSetup: ['tests/integration/global-setup.ts'],
		setupFiles: ['tests/integration/setup.ts'],
		// One database, so files run one after another.
		fileParallelism: false,
		testTimeout: 30000,
		hookTimeout: 60000,
	},
})
