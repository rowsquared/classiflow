import { defineConfig } from 'prisma/config'

// Prisma 7 no longer reads .env by itself. Load it when present (local
// development); variables already set in the environment win, so Compose,
// CI and the integration tests keep their own DATABASE_URL.
try {
  process.loadEnvFile()
} catch {
  // No .env file: rely on the environment.
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  // Optional so `prisma generate` (postinstall, image build) runs without a
  // database; migrate commands fail clearly when it is missing.
  datasource: {
    url: process.env.DATABASE_URL,
  },
})
