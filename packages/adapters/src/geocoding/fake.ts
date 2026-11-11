import type { GeocodeResult, Geocoder } from "@bojen/core";

/** A few made-up addresses in the archipelago; matches on any word in the label. */
const PLACES: GeocodeResult[] = [
  { label: "Bryggvägen 12, Värmdö", position: { lng: 18.62, lat: 59.31 } },
  { label: "Sjöstigen 4, Djurö", position: { lng: 18.7, lat: 59.31 } },
  { label: "Hamnvägen 2, Stavsnäs", position: { lng: 18.69, lat: 59.29 } },
  { label: "Strandvägen 7, Saltsjöbaden", position: { lng: 18.3, lat: 59.28 } },
];

export function createFakeGeocoder(places: GeocodeResult[] = PLACES): Geocoder {
  return {
    search(query, { limit = 5 } = {}) {
      const words = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length >= 3);
      if (words.length === 0) return Promise.resolve([]);
      return Promise.resolve(
        places.filter((p) => words.some((w) => p.label.toLowerCase().includes(w))).slice(0, limit),
      );
    },
  };
}
