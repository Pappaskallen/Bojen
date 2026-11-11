import type { DriveLeg, GeoPoint, MapsProvider } from "@bojen/core";

/**
 * Up to 25 origins and 25 destinations per request keeps the URL short and stays inside
 * OSRM's default table limit (`--max-table-size 100`).
 */
const CHUNK = 25;

export interface OsrmOptions {
  /** For example `http://localhost:5000` for an own server with the Sweden extract. */
  baseUrl: string;
  /** Injected so tests never reach the network. */
  fetch?: typeof globalThis.fetch;
}

interface TableResponse {
  code: string;
  message?: string;
  durations?: (number | null)[][];
  distances?: (number | null)[][];
}

function chunks<T>(list: readonly T[]): { offset: number; items: T[] }[] {
  const result: { offset: number; items: T[] }[] = [];
  for (let offset = 0; offset < list.length; offset += CHUNK) {
    result.push({ offset, items: list.slice(offset, offset + CHUNK) });
  }
  return result;
}

const coordinate = (p: GeoPoint) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`;
const indexes = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => from + i).join(";");

/**
 * OSRM Table service on OpenStreetMap data, by car. Free and open source; it knows no
 * traffic, so the departure time does not change the answer. Pairs without a road between
 * them (null in the table) are left out of the result.
 */
export function createOsrmMaps(options: OsrmOptions): MapsProvider {
  const send = options.fetch ?? globalThis.fetch;
  const base = options.baseUrl.replace(/\/+$/, "");

  async function table(origins: readonly GeoPoint[], destinations: readonly GeoPoint[]) {
    const points = [...origins, ...destinations].map(coordinate).join(";");
    const query = new URLSearchParams({
      sources: indexes(0, origins.length),
      destinations: indexes(origins.length, destinations.length),
      annotations: "duration,distance",
    });
    const response = await send(`${base}/table/v1/driving/${points}?${query.toString()}`);
    const body = (await response.json().catch(() => ({ code: "InvalidJson" }))) as TableResponse;
    // Coordinates are customers' places, so they are not part of the error message.
    if (!response.ok || body.code !== "Ok") {
      throw new Error(`OSRM answered ${response.status} ${body.code}`);
    }
    return body;
  }

  return {
    name: "osrm",
    async driveMatrix(origins, destinations) {
      const legs: DriveLeg[] = [];
      for (const o of chunks(origins)) {
        for (const d of chunks(destinations)) {
          const { durations = [], distances = [] } = await table(o.items, d.items);
          durations.forEach((row, i) =>
            row.forEach((seconds, j) => {
              if (seconds === null) return;
              legs.push({
                originIndex: o.offset + i,
                destinationIndex: d.offset + j,
                seconds: Math.round(seconds),
                meters: Math.round(distances[i]?.[j] ?? 0),
              });
            }),
          );
        }
      }
      return legs;
    },
  };
}
