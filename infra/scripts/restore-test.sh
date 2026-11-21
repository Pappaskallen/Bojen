#!/bin/sh
# A restore test (spec 10.7: every quarter), on the server, beside the running database:
#   sh infra/scripts/restore-test.sh                       # the latest state
#   sh infra/scripts/restore-test.sh "2026-12-01 14:00:00+01"   # a chosen point in time
# Fetches the latest full backup from the archive into a temporary container, replays the
# write-ahead log up to the chosen time and checks that Bojen's tables are there. The
# running database is not touched.
set -eu
cd "$(dirname "$0")/.."
TARGET="${1:-}"
NAME=bojen-restore-test
set -a; . ./.env; set +a

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --entrypoint sleep \
  -e WALG_S3_PREFIX="s3://$BACKUP_BUCKET/postgres" -e AWS_ENDPOINT="$BACKUP_ENDPOINT" \
  -e AWS_REGION="$BACKUP_REGION" -e AWS_ACCESS_KEY_ID="$BACKUP_ACCESS_KEY" \
  -e AWS_SECRET_ACCESS_KEY="$BACKUP_SECRET_KEY" -e AWS_S3_FORCE_PATH_STYLE=true \
  -e WALG_LIBSODIUM_KEY="$BACKUP_ENCRYPTION_KEY" -e WALG_LIBSODIUM_KEY_TRANSFORM=hex \
  -e PGPASSWORD="$POSTGRES_PASSWORD" \
  bojen-postgres infinity >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

run() { docker exec -u postgres "$NAME" sh -c "$1"; }
run 'mkdir -p /tmp/restore && chmod 700 /tmp/restore && wal-g backup-fetch /tmp/restore LATEST'
RECOVERY="restore_command = '/usr/local/bin/wal-g wal-fetch %f %p'"
if [ -n "$TARGET" ]; then
  RECOVERY="$RECOVERY
recovery_target_time = '$TARGET'
recovery_target_action = 'promote'"
fi
run "printf '%s\n' \"$RECOVERY\" >> /tmp/restore/postgresql.auto.conf && touch /tmp/restore/recovery.signal"
run 'postgres -D /tmp/restore -c config_file=/etc/postgresql/postgresql.conf -c data_directory=/tmp/restore -c port=5433 -c archive_mode=off > /tmp/restore.log 2>&1 &'

for _ in $(seq 1 120); do
  if run 'pg_isready -h localhost -p 5433 -U postgres' >/dev/null 2>&1 \
    && [ "$(run "psql -h localhost -p 5433 -U supabase_admin -d postgres -tAc 'select pg_is_in_recovery()'")" = "f" ]; then
    break
  fi
  sleep 5
done
if [ "$(run "psql -h localhost -p 5433 -U supabase_admin -d postgres -tAc 'select pg_is_in_recovery()'" 2>/dev/null)" != "f" ]; then
  run 'tail -20 /tmp/restore.log'
  echo "Återställningen blev inte klar. Ligger tidpunkten efter den senast arkiverade skrivloggen? Prova en minut tidigare." >&2
  exit 1
fi
TENANTS=$(run "psql -h localhost -p 5433 -U supabase_admin -d postgres -tAc 'select count(*) from public.tenant'")
LATEST=$(run "psql -h localhost -p 5433 -U supabase_admin -d postgres -tAc 'select max(occurred_at) from public.audit_log'")
echo "Återställningen fungerade: $TENANTS firmor, senaste händelse i revisionsloggen $LATEST."
