#!/bin/sh
# Container start command (docker-compose.yml). DATABASE_URL is the schema
# owner: it applies migrations. The server and the admin bootstrap then run as
# the least-privilege role APP_DB_USER (scripts/db-runtime-role.ts). That role
# is what workspace row security binds (the owner is exempt), so production
# refuses to start without it.
set -e

if [ -z "${APP_DB_USER:-}" ]; then
  if [ "${NODE_ENV:-}" = "production" ] && [ "${ALLOW_OWNER_RUNTIME:-}" != "true" ]; then
    echo "✗ APP_DB_USER and APP_DB_PASSWORD are required: the server must not run as the schema owner (DEPLOYMENT.md \"Database roles\")." >&2
    exit 1
  fi
  echo "⚠ APP_DB_USER is not set: the server runs as the schema owner and workspace row security does not apply." >&2
fi

# The scripts are TypeScript run by Node's type stripping; the package has no
# "type" field, so Node would warn that it detected ES module syntax.
node_script() {
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "$@"
}

# The Prisma CLI directly, not through npx: npm would try to write its cache
# and logs under $HOME, which is read-only in production (docker-compose.yml).
node_modules/.bin/prisma migrate deploy

# The demo seed writes a new workspace, which row security only lets the owner do.
OWNER_DATABASE_URL=$DATABASE_URL

if [ -n "${APP_DB_USER:-}" ]; then
  node_script scripts/db-runtime-role.ts
  DATABASE_URL=$(node_script scripts/db-runtime-role.ts --url)
  export DATABASE_URL
fi

node_script scripts/init-admin.ts

# Optional demo workspace for staging (ENV_SETUP.md "Demo data"). A failure
# leaves no partial data behind and does not stop the server.
case "${DEMO_SEED:-}" in
  true | reset)
    DATABASE_URL=$OWNER_DATABASE_URL node_script scripts/seed-demo.ts ||
      echo "⚠ Demo data could not be seeded; starting without it" >&2
    ;;
esac

exec node server.js
