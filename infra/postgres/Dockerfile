# Supabase's Postgres (PostGIS, the auth and storage schemas) with WAL-G for continuous
# archiving and point-in-time recovery (spec 10.7, byggplan step 9). The image's own WAL-G is
# not documented for Docker, so a pinned release is added and its checksum checked.
FROM supabase/postgres:17.6.1.136

ARG WALG_VERSION=v3.0.9
ARG WALG_SHA256=51ec330530f98fc3eb4f008fa539d291a2cac51e7076b256472862e45ceff0bd
USER root
ADD https://github.com/wal-g/wal-g/releases/download/${WALG_VERSION}/wal-g-pg-20.04-amd64.tar.gz /tmp/wal-g.tar.gz
RUN echo "${WALG_SHA256}  /tmp/wal-g.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/wal-g.tar.gz -C /tmp \
 && install -m 0755 /tmp/wal-g-pg-20.04-amd64 /usr/local/bin/wal-g \
 && rm /tmp/wal-g.tar.gz /tmp/wal-g-pg-20.04-amd64

# Passwords for the roles the Auth and Storage services log in as, on the first start.
COPY init/ /docker-entrypoint-initdb.d/init-scripts/
