#!/bin/sh
# The nightly full backup (spec 10.7, byggplan step 9). The write-ahead log is archived all the
# time by Postgres itself (archive_command); this adds a full base backup each night and keeps
# 35 days of them, so any point in the last 35 days can be restored (the spec asks for 7).
# Run by the systemd timer that infra/scripts/setup-server.sh installs.
set -eu
cd "$(dirname "$0")/.."
compose() { docker compose -f docker-compose.yml --env-file .env "$@"; }
compose exec -T -u postgres db sh -c 'wal-g backup-push "$PGDATA"'
compose exec -T -u postgres db wal-g delete retain FULL 35 --confirm
echo "Säkerhetskopia klar: $(date -u +%FT%TZ)"
