import { describe, expect, it } from "vitest";
import { createFakeMaps } from "./fake";
import { createOsrmMaps } from "./osrm";

const slussen = { lng: 18.07, lat: 59.32 };
const bullando = { lng: 18.64, lat: 59.29 };
const departure = new Date("2027-06-15T06:00:00Z");

describe("fake maps", () => {
  it("returns every pair and records the call", async () => {
    const maps = createFakeMaps();
    const legs = await maps.driveMatrix([slussen, bullando], [bullando], departure);
    expect(legs.map((l) => [l.originIndex, l.destinationIndex])).toEqual([
      [0, 0],
      [1, 0],
    ]);
    expect(legs[1]?.seconds).toBe(0);
    expect(legs[0]?.seconds).toBeGreaterThan(30 * 60);
    expect(maps.calls).toHaveLength(1);
  });
});

describe("OSRM maps", () => {
  /** Answers like OSRM's table service: sources × destinations, read from the URL. */
  function fakeOsrm(cell: (source: number, destination: number) => number | null) {
    const urls: URL[] = [];
    const fetch = (input: string | URL | Request) => {
      const url = new URL(String(input));
      urls.push(url);
      const sources = (url.searchParams.get("sources") ?? "").split(";").map(Number);
      const destinations = (url.searchParams.get("destinations") ?? "").split(";").map(Number);
      const grid = sources.map((s) => destinations.map((d) => cell(s, d)));
      return Promise.resolve(
        Response.json({
          code: "Ok",
          durations: grid,
          distances: grid.map((row) => row.map((v) => (v === null ? null : v * 10))),
        }),
      );
    };
    return { fetch: fetch as typeof globalThis.fetch, urls };
  }

  it("asks the table service for a driving matrix and reads the answer", async () => {
    const { fetch, urls } = fakeOsrm((s, d) => (s === 0 ? 1980.4 : s + d));
    const maps = createOsrmMaps({ baseUrl: "http://osrm.test/", fetch });

    const legs = await maps.driveMatrix([slussen, bullando], [bullando], departure);

    expect(legs).toEqual([
      { originIndex: 0, destinationIndex: 0, seconds: 1980, meters: 19804 },
      { originIndex: 1, destinationIndex: 0, seconds: 3, meters: 30 },
    ]);
    const [url] = urls;
    expect(url?.origin + url!.pathname).toBe(
      "http://osrm.test/table/v1/driving/18.070000,59.320000;18.640000,59.290000;18.640000,59.290000",
    );
    expect(url?.searchParams.get("sources")).toBe("0;1");
    expect(url?.searchParams.get("destinations")).toBe("2");
    expect(url?.searchParams.get("annotations")).toBe("duration,distance");
  });

  it("leaves out pairs without a road", async () => {
    const { fetch } = fakeOsrm(() => null);
    const maps = createOsrmMaps({ baseUrl: "http://osrm.test", fetch });
    expect(await maps.driveMatrix([slussen], [bullando], departure)).toEqual([]);
  });

  it("splits large matrices into requests of at most 25 × 25", async () => {
    const { fetch, urls } = fakeOsrm(() => 60);
    const maps = createOsrmMaps({ baseUrl: "http://osrm.test", fetch });
    const points = Array.from({ length: 30 }, (_, i) => ({ lng: 18 + i / 100, lat: 59.3 }));

    const legs = await maps.driveMatrix(points, points, departure);

    expect(urls).toHaveLength(4);
    expect(legs).toHaveLength(900);
    expect(legs.some((l) => l.originIndex === 29 && l.destinationIndex === 29)).toBe(true);
  });

  it("fails on an error answer without putting the coordinates in the message", async () => {
    const fetch = (() =>
      Promise.resolve(
        Response.json({ code: "InvalidQuery", message: "18.07,59.32" }, { status: 400 }),
      )) as typeof globalThis.fetch;
    const maps = createOsrmMaps({ baseUrl: "http://osrm.test", fetch });
    await expect(maps.driveMatrix([slussen], [bullando], departure)).rejects.toThrow(
      /^OSRM answered 400 InvalidQuery$/,
    );
  });
});
