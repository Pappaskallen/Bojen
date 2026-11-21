#!/bin/sh
# Builds the OSRM road network for Sweden (byggplan step 2.2 and 9), on the server:
#   sh infra/scripts/osrm-prepare.sh
# Renew a few times a year: new roads and ferries come with the map.
set -eu
cd "$(dirname "$0")/.."
mkdir -p data/osrm
cd data/osrm
curl -fsSL -o sweden-latest.osm.pbf https://download.geofabrik.de/europe/sweden-latest.osm.pbf
curl -fsSL -o sweden-latest.osm.pbf.md5 https://download.geofabrik.de/europe/sweden-latest.osm.pbf.md5
md5sum -c sweden-latest.osm.pbf.md5
IMAGE=ghcr.io/project-osrm/osrm-backend:v26.10.0
docker run --rm -v "$PWD:/data" "$IMAGE" osrm-extract -p /opt/car.lua /data/sweden-latest.osm.pbf
docker run --rm -v "$PWD:/data" "$IMAGE" osrm-partition /data/sweden-latest.osrm
docker run --rm -v "$PWD:/data" "$IMAGE" osrm-customize /data/sweden-latest.osrm
rm sweden-latest.osm.pbf sweden-latest.osm.pbf.md5
docker compose -f ../../docker-compose.yml --env-file ../../.env restart osrm || true
echo "OSRM: Sverige klart."
