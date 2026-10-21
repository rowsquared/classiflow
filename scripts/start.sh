#!/bin/sh
# Container start command (docker-compose.yml). DATABASE_URL is the schema
# owner: it applies migrations. With APP_DB_USER set, the server and the admin
# bootstrap then run as that least-privilege role (scripts/db-runtime-role.js).
set -e

npx prisma migrate deploy

if [ -n "${APP_DB_USER:-}" ]; then
  node scripts/db-runtime-role.js
  DATABASE_URL=$(node scripts/db-runtime-role.js --url)
  export DATABASE_URL
fi

node scripts/init-admin.js
exec node server.js
