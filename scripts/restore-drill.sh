#!/bin/sh
# Restore drill: restores a backup into a throwaway PostgreSQL 18 container,
# checks it and reports how long the restore took. Touches nothing else; the
# container is removed afterwards. See "Backups" in DEPLOYMENT.md.
#
#   scripts/restore-drill.sh classiflow-2026-10-21.dump
#
# The backup is a pg_dump custom-format file (pg_dump -Fc). Run it from a
# checkout of the deployed commit after `npm ci`: the checks at the end
# (scripts/restore-check.ts) set up the runtime role as the app's start script
# does and verify row security and every workspace's rows through it.
set -eu

dump=${1:?usage: scripts/restore-drill.sh <backup.dump>}
[ -r "$dump" ] || { echo "Cannot read $dump" >&2; exit 1; }
[ -d node_modules/@prisma/adapter-pg ] && [ -d lib/generated/prisma ] || {
  echo "Run this from the repository root after npm ci (it needs the Prisma client for the checks)." >&2
  exit 1
}

name="classiflow-restore-drill-$$"
# Published on a random local port for the checks run from this host.
docker run -d --rm --name "$name" -p 127.0.0.1::5432 \
  -e POSTGRES_USER=classiflow -e POSTGRES_PASSWORD=restore-drill -e POSTGRES_DB=classiflow \
  postgres:18-alpine >/dev/null
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT
port=$(docker port "$name" 5432/tcp | head -n 1 | sed 's/.*://')

# Over TCP: the image's first-start init server listens on the socket only.
until docker exec "$name" pg_isready -q -h 127.0.0.1 -U classiflow; do sleep 1; done

start=$(date +%s)
# Owners and grants are left out: roles differ between hosts, and the app's
# start script re-applies the runtime role's grants.
docker exec -i "$name" pg_restore -U classiflow -d classiflow \
  --no-owner --no-privileges --exit-on-error < "$dump"
seconds=$(( $(date +%s) - start ))

docker exec "$name" psql -U classiflow -d classiflow -v ON_ERROR_STOP=1 -P pager=off \
  -c 'SELECT migration_name AS latest_migration, finished_at FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1' \
  -c 'SELECT (SELECT count(*) FROM "User") AS users,
             (SELECT count(*) FROM "Taxonomy") AS taxonomies,
             (SELECT count(*) FROM "Sentence") AS records,
             (SELECT count(*) FROM "SentenceAnnotation") AS labels,
             (SELECT count(*) FROM "Comment") AS comments'

# Migrations, row security on every workspace table, the least-privilege
# runtime role (created here the way scripts/start.sh does) and, per
# workspace, the same rows through that role as through the owner.
DATABASE_URL="postgresql://classiflow:restore-drill@127.0.0.1:$port/classiflow" \
  APP_DB_USER=classiflow_app APP_DB_PASSWORD=restore-drill-runtime-password \
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/restore-check.ts

echo "Restore drill passed: $dump restored in ${seconds}s. Compare the counts with production."
