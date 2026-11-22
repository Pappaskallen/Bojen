#!/bin/sh
# A deploy on the server (byggplan step 9), as the bojen user in /srv/bojen. Run by the
# deploy workflow when CI is green on main, or by hand:
#   sh infra/scripts/deploy.sh [commit]
# Builds the images, runs the migrations and restarts what changed. Postgres keeps running.
set -eu
# All in one function, so the shell has read it whole before git checks out a new version.
main() {
cd "$(dirname "$0")/../.."
git fetch --quiet origin main
git checkout --quiet --detach "${1:-origin/main}"
set -a; . infra/.env; set +a
export APP_RELEASE="$(git rev-parse --short HEAD)"

docker build -f infra/app.Dockerfile -t bojen-app \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="https://$API_DOMAIN" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  --build-arg NEXT_PUBLIC_VAPID_PUBLIC_KEY="${NEXT_PUBLIC_VAPID_PUBLIC_KEY:-}" .

compose() { docker compose -f infra/docker-compose.yml --env-file infra/.env ${PROFILES:-} "$@"; }
compose build db photon
compose up -d db
compose --profile deploy run --rm migrate
compose up -d --remove-orphans
docker image prune -f >/dev/null
echo "Driftsatt: $(git rev-parse --short HEAD)"
}
main "$@"
