import { estimateDrive, type GeoPoint, type MapsProvider } from "@bojen/core";

export interface FakeMaps extends MapsProvider {
  /** Every call, in order, so tests can see whether the cache was used. */
  readonly calls: { origins: GeoPoint[]; destinations: GeoPoint[]; departure: Date }[];
}

/** Maps without the network: crow flies × 1.4 at 50 km/h, the same at every hour. */
export function createFakeMaps(): FakeMaps {
  const calls: FakeMaps["calls"] = [];
  return {
    name: "fake",
    calls,
    driveMatrix(origins, destinations, departure) {
      calls.push({ origins: [...origins], destinations: [...destinations], departure });
      return Promise.resolve(
        origins.flatMap((from, originIndex) =>
          destinations.map((to, destinationIndex) => ({
            originIndex,
            destinationIndex,
            ...estimateDrive(from, to),
          })),
        ),
      );
    },
  };
}
