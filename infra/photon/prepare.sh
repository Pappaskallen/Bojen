#!/bin/sh
# Builds Photon's address index for Sweden (byggplan step 2.5 and 9) from Photon's own
# planet dump, keeping only Swedish addresses. Runs once in the Photon image:
#   docker compose -f infra/docker-compose.yml --env-file infra/.env run --rm photon /photon/prepare.sh
# The dump is large and is streamed, not stored; the import takes hours. Then restart photon.
set -eu
curl -fsSL https://download1.graphhopper.com/public/photon-dump-planet-1.0-latest.jsonl.zst \
  | zstd -dc \
  | java -Xmx6g -jar /photon/photon.jar import -import-file - -data-dir /photon/data \
      -country-codes se -languages sv,en
echo "Photon: Sverige klart."
