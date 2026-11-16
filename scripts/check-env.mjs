const origin = URL.parse(process.env.BETTER_AUTH_URL ?? '')
const loopback = origin && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
if (
  !origin ||
  origin.username ||
  origin.password ||
  origin.search ||
  origin.hash ||
  origin.pathname !== '/' ||
  (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && loopback))
) {
  throw new Error('Set BETTER_AUTH_URL to the public HTTPS origin. HTTP is allowed for localhost only.')
}

const database = URL.parse(process.env.DATABASE_URL ?? '')
if (!database || !['postgresql:', 'postgres:'].includes(database.protocol)) {
  throw new Error('Set DATABASE_URL to the PostgreSQL migration connection.')
}

if (!process.env.BETTER_AUTH_SECRET?.trim()) throw new Error('Set BETTER_AUTH_SECRET before starting classiflow.')

for (const [name, minimum] of Object.entries({
  DATABASE_POOL_SIZE: 1,
  TRUSTED_PROXY_HOPS: 0,
  SIGN_IN_RATE_LIMIT: 1,
  SIGN_IN_ACCOUNT_RATE_LIMIT: 1,
  AI_LABELING_BATCH_SIZE: 1,
  AI_LEARNING_BATCH_SIZE: 1,
  AI_LEARNING_MIN_NEW_ANNOTATIONS: 1,
  AI_JOB_POLL_INTERVAL_MS: 1,
  AI_JOB_POLL_TIMEOUT_MS: 1,
  AI_MAX_ACTIVE_JOBS_PER_WORKSPACE: 1,
  AI_MAX_ACTIVE_JOBS_PER_ENDPOINT: 1,
  AI_MAX_ACTIVE_JOBS: 1
})) {
  const value = process.env[name]?.trim()
  if (value && (!/^\d+$/.test(value) || Number(value) < minimum || Number(value) > 2147483647)) {
    throw new Error(`${name} must be an integer between ${minimum} and 2147483647.`)
  }
}
