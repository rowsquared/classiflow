#!/bin/sh
# Container start command (docker-compose.yml). DATABASE_URL is the schema
# owner: it applies migrations. With APP_DB_USER set, the server and the admin
# bootstrap then run as that least-privilege role (scripts/db-runtime-role.ts).
set -e

# The scripts are TypeScript run by Node's type stripping; the package has no
# "type" field, so Node would warn that it detected ES module syntax.
node_script() {
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "$@"
}

npx prisma migrate deploy

if [ -n "${APP_DB_USER:-}" ]; then
  node_script scripts/db-runtime-role.ts
  DATABASE_URL=$(node_script scripts/db-runtime-role.ts --url)
  export DATABASE_URL
fi

node_script scripts/init-admin.ts
exec node server.js
