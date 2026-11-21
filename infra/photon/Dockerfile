# Photon address search with the Swedish index (byggplan step 2.5 and 9). The index is built
# once by prepare.sh into the photon-data volume (see infra/README.md).
FROM eclipse-temurin:21.0.12_8-jre-noble
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl zstd \
 && rm -rf /var/lib/apt/lists/*

ARG PHOTON_VERSION=1.3.0
ADD https://github.com/komoot/photon/releases/download/${PHOTON_VERSION}/photon-${PHOTON_VERSION}.jar /photon/photon.jar
COPY --chmod=0755 prepare.sh /photon/prepare.sh
WORKDIR /photon
EXPOSE 2322
CMD ["java", "-Xmx4g", "-jar", "/photon/photon.jar", "serve", "-data-dir", "/photon/data", "-listen-ip", "0.0.0.0"]
