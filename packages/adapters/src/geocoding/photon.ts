import type { GeocodeResult, Geocoder } from "@bojen/core";

export interface PhotonOptions {
  /** Default the public server `https://photon.komoot.io`; an own server later. */
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    street?: string;
    housenumber?: string;
    postcode?: string;
    city?: string;
    district?: string;
    county?: string;
    countrycode?: string;
  };
}

function label(p: NonNullable<PhotonFeature["properties"]>): string {
  const street = [p.street, p.housenumber].filter(Boolean).join(" ");
  const first = p.name && p.name !== p.street ? p.name : street;
  const place = p.city ?? p.district ?? p.county;
  return [first, first === street ? undefined : street, place]
    .filter((part, i, all) => part && all.indexOf(part) === i)
    .join(", ");
}

/**
 * Photon address search on OpenStreetMap data. Free; only Swedish results are kept.
 * What the customer types is sent to the Photon server, so production should use an
 * own server inside the EU (the public one is run by Komoot in Germany).
 */
export function createPhotonGeocoder(options: PhotonOptions = {}): Geocoder {
  const send = options.fetch ?? globalThis.fetch;
  const base = (options.baseUrl ?? "https://photon.komoot.io").replace(/\/+$/, "");

  return {
    async search(query, { near, limit = 5 } = {}) {
      const text = query.trim();
      if (text.length < 3) return [];
      const params = new URLSearchParams({ q: text, limit: String(limit * 2), lang: "default" });
      if (near) {
        params.set("lat", String(near.lat));
        params.set("lon", String(near.lng));
      }
      const response = await send(`${base}/api/?${params.toString()}`, {
        headers: { "User-Agent": "Bojen booking (address search)" },
      });
      // The query is the customer's address, so it is not part of the error message.
      if (!response.ok) throw new Error(`Photon answered ${String(response.status)}`);
      const body = (await response.json()) as { features?: PhotonFeature[] };

      const results: GeocodeResult[] = [];
      for (const f of body.features ?? []) {
        const [lng, lat] = f.geometry?.coordinates ?? [];
        const p = f.properties;
        if (lng === undefined || lat === undefined || !p || p.countrycode?.toUpperCase() !== "SE") {
          continue;
        }
        results.push({ label: label(p), position: { lng, lat } });
      }
      return results.slice(0, limit);
    },
  };
}
