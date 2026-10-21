#!/bin/sh
# Restore drill: restores a backup into a throwaway PostgreSQL 18 container,
# checks it and reports how long the restore took. Touches nothing else; the
# container is removed afterwards. See "Backups" in DEPLOYMENT.md.
#
#   scripts/restore-drill.sh classiflow-2026-10-21.dump
#
# The backup is a pg_dump custom-format file (pg_dump -Fc).
set -eu

dump=${1:?usage: scripts/restore-drill.sh <backup.dump>}
[ -r "$dump" ] || { echo "Cannot read $dump" >&2; exit 1; }

name="classiflow-restore-drill-$$"
docker run -d --rm --name "$name" \
  -e POSTGRES_USER=classiflow -e POSTGRES_PASSWORD=restore-drill -e POSTGRES_DB=classiflow \
  postgres:18-alpine >/dev/null
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT

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

echo "Restore drill passed: $dump restored in ${seconds}s. Compare the counts with production."
