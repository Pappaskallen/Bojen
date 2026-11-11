import { describe, expect, it } from "vitest";
import {
  crossingSeconds,
  crowFliesMeters,
  departureHour,
  estimateDrive,
  missingPairs,
  pairKey,
  travelSeconds,
  type TravelPlace,
} from "./travel";

const bullando: TravelPlace = {
  id: "bullando",
  position: { lng: 18.64, lat: 59.29 },
  accessMethod: "car",
};
const sandhamn: TravelPlace = {
  id: "sandhamn",
  position: { lng: 18.91, lat: 59.29 },
  accessMethod: "ferry",
  crossingMinutes: 45,
};
const islet: TravelPlace = {
  id: "islet",
  position: { lng: 18.7, lat: 59.3 },
  accessMethod: "boat",
  crossingMinutes: 10,
};

describe("crowFliesMeters", () => {
  it("is about 111.2 km per degree of latitude", () => {
    expect(crowFliesMeters({ lng: 18, lat: 59 }, { lng: 18, lat: 60 })).toBeCloseTo(111_195, -1);
  });

  it("is zero for the same point and the same both ways", () => {
    const a = { lng: 18.07, lat: 59.32 };
    const b = { lng: 18.64, lat: 59.29 };
    expect(crowFliesMeters(a, a)).toBe(0);
    expect(crowFliesMeters(a, b)).toBeCloseTo(crowFliesMeters(b, a), 6);
  });
});

describe("estimateDrive", () => {
  it("drives crow flies × 1.4 at 50 km/h", () => {
    // 1 degree of latitude: 111.195 km × 1.4 = 155.67 km, which takes 3.11 h at 50 km/h.
    const leg = estimateDrive({ lng: 18, lat: 59 }, { lng: 18, lat: 60 });
    expect(leg.meters).toBeCloseTo(155_673, -1);
    expect(leg.seconds).toBeCloseTo((155_673 / 50_000) * 3600, -1);
  });
});

describe("departureHour", () => {
  it("cuts the departure to the start of the hour", () => {
    expect(departureHour(new Date("2027-06-15T06:59:59.999Z")).toISOString()).toBe(
      "2027-06-15T06:00:00.000Z",
    );
    expect(departureHour(new Date("2027-06-15T07:00:00Z")).toISOString()).toBe(
      "2027-06-15T07:00:00.000Z",
    );
  });
});

describe("travelSeconds", () => {
  it.each<[string, TravelPlace, TravelPlace, number]>([
    ["car to car: the drive only", bullando, { ...bullando, id: "other" }, 1200],
    ["to a ferry island: drive + crossing out", bullando, sandhamn, 1200 + 45 * 60],
    ["from a ferry island: crossing back + drive", sandhamn, bullando, 45 * 60 + 1200],
    ["island to island: both crossings", sandhamn, islet, 45 * 60 + 1200 + 10 * 60],
    ["the same place: no travel", sandhamn, sandhamn, 0],
  ])("%s", (_name, from, to, expected) => {
    expect(travelSeconds(from, to, 1200)).toBe(expected);
  });

  it("ignores a crossing time on a place reached by car", () => {
    expect(crossingSeconds({ accessMethod: "car", crossingMinutes: 30 })).toBe(0);
    expect(crossingSeconds({ accessMethod: "boat", crossingMinutes: null })).toBe(0);
  });
});

describe("missingPairs", () => {
  it("skips cached pairs, the same place twice and duplicates", () => {
    const pairs = [
      { fromId: "a", toId: "b" },
      { fromId: "a", toId: "a" },
      { fromId: "b", toId: "a" },
      { fromId: "a", toId: "c" },
      { fromId: "a", toId: "c" },
    ];
    const cached = new Set([pairKey({ fromId: "b", toId: "a" })]);
    expect(missingPairs(pairs, cached)).toEqual([
      { fromId: "a", toId: "b" },
      { fromId: "a", toId: "c" },
    ]);
  });
});
