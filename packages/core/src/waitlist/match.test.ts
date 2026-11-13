import { describe, expect, it } from "vitest";
import {
  nextBatch,
  nextRoundAt,
  rankCandidates,
  waitlistStarts,
  type Candidate,
  type FreedSlot,
} from "./match";

const BULLANDO = { lng: 18.69, lat: 59.29 };
/** About 5 km from Bullandö. */
const CLOSE = { lng: 18.69, lat: 59.335 };
/** About 25 km from Bullandö. */
const FAR = { lng: 18.69, lat: 59.515 };

const slot: FreedSlot = {
  start: new Date("2026-11-18T09:00:00+01:00"),
  end: new Date("2026-11-18T11:00:00+01:00"),
  day: "2026-11-18",
  locationId: "bullando",
  areaId: "varmdo",
  position: BULLANDO,
};

let n = 0;
function candidate(over: Partial<Candidate> = {}): Candidate {
  n += 1;
  return {
    entryId: `entry-${String(n).padStart(2, "0")}`,
    customerId: `customer-${String(n).padStart(2, "0")}`,
    areaId: null,
    serviceMinutes: 120,
    requiredMode: null,
    earliestDate: null,
    latestDate: null,
    createdAt: new Date("2026-10-01T10:00:00Z"),
    boat: { locationId: "bullando", position: BULLANDO, mode: "land" },
    doneVisits: 0,
    ...over,
  };
}
const ids = (c: Candidate[]) => rankCandidates(slot, c).map((r) => r.candidate.entryId);

describe("which waiting customers a freed time suits", () => {
  it("takes the same area, or a boat within 10 km", () => {
    const sameArea = candidate({
      areaId: "varmdo",
      boat: { locationId: "elsewhere", position: FAR, mode: "land" },
    });
    const otherArea = candidate({
      areaId: "nacka",
      boat: { locationId: "elsewhere", position: FAR, mode: "land" },
    });
    const close = candidate({ boat: { locationId: "elsewhere", position: CLOSE, mode: "land" } });
    const far = candidate({ boat: { locationId: "elsewhere", position: FAR, mode: "land" } });
    const unplaced = candidate({ boat: null });
    const unplacedSameArea = candidate({ boat: null, areaId: "varmdo" });
    expect(ids([sameArea, otherArea, close, far, unplaced, unplacedSameArea]).sort()).toEqual(
      [sameArea, close, unplacedSameArea].map((c) => c.entryId).sort(),
    );
  });

  it("keeps the 10 km limit exact", () => {
    // 0.09 degrees of latitude is 10.01 km, 0.0899 degrees is 9.99 km.
    const over = candidate({
      boat: { locationId: "x", position: { lng: 18.69, lat: 59.29 + 0.09 }, mode: "land" },
    });
    const under = candidate({
      boat: { locationId: "x", position: { lng: 18.69, lat: 59.29 + 0.0899 }, mode: "land" },
    });
    expect(ids([over, under])).toEqual([under.entryId]);
  });

  it("needs the service to fit in the time", () => {
    const fits = candidate({ serviceMinutes: 120 });
    const tooLong = candidate({ serviceMinutes: 121 });
    const shorter = candidate({ serviceMinutes: 60 });
    const noService = candidate({ serviceMinutes: null });
    expect(ids([fits, tooLong, shorter, noService]).sort()).toEqual(
      [fits, shorter].map((c) => c.entryId).sort(),
    );
  });

  it("needs the boat's mode to meet the service's requirement", () => {
    const needsWater = candidate({
      requiredMode: "water",
      boat: { locationId: "bullando", position: BULLANDO, mode: "land" },
    });
    const needsLand = candidate({
      requiredMode: "land",
      boat: { locationId: "bullando", position: BULLANDO, mode: "indoor" },
    });
    const anyMode = candidate({ requiredMode: null });
    expect(ids([needsWater, needsLand, anyMode]).sort()).toEqual(
      [needsLand, anyMode].map((c) => c.entryId).sort(),
    );
  });

  it("needs the day to lie in the customer's dates, both ends included", () => {
    const first = candidate({ earliestDate: "2026-11-18" });
    const last = candidate({ latestDate: "2026-11-18" });
    const tooEarly = candidate({ earliestDate: "2026-11-19" });
    const tooLate = candidate({ latestDate: "2026-11-17" });
    const open = candidate();
    expect(ids([first, last, tooEarly, tooLate, open]).sort()).toEqual(
      [first, last, open].map((c) => c.entryId).sort(),
    );
  });
});

describe("the order of the offers", () => {
  it("puts the same marina first, then the longest wait, then the most done visits", () => {
    const nearbyOld = candidate({
      boat: { locationId: "other", position: CLOSE, mode: "land" },
      createdAt: new Date("2026-09-01T10:00:00Z"),
    });
    const marinaNew = candidate({ createdAt: new Date("2026-10-20T10:00:00Z") });
    const marinaOld = candidate({ createdAt: new Date("2026-10-05T10:00:00Z") });
    const marinaOldMoreVisits = candidate({
      createdAt: new Date("2026-10-05T10:00:00Z"),
      doneVisits: 4,
    });
    expect(ids([nearbyOld, marinaNew, marinaOld, marinaOldMoreVisits])).toEqual([
      marinaOldMoreVisits.entryId,
      marinaOld.entryId,
      marinaNew.entryId,
      nearbyOld.entryId,
    ]);
  });

  it("says på for the same marina and nära for the others", () => {
    const here = candidate();
    const near = candidate({ boat: { locationId: "other", position: CLOSE, mode: "land" } });
    const ranked = rankCandidates(slot, [near, here]);
    expect(ranked.map((r) => r.samePlace)).toEqual([true, false]);
  });

  it("is stable for entries that tie in everything", () => {
    const a = candidate();
    const b = candidate();
    expect(ids([b, a])).toEqual([a.entryId, b.entryId]);
  });
});

describe("the rounds", () => {
  const ranked = rankCandidates(
    slot,
    Array.from({ length: 12 }, (_, i) =>
      candidate({ createdAt: new Date(`2026-10-${String(i + 1).padStart(2, "0")}T10:00:00Z`) }),
    ),
  );

  it("sends to five at a time", () => {
    const first = nextBatch(ranked, new Set());
    expect(first).toHaveLength(5);
    const offered = new Set(first.map((r) => r.candidate.customerId));
    const second = nextBatch(ranked, offered);
    expect(second).toHaveLength(5);
    expect(second.some((r) => offered.has(r.candidate.customerId))).toBe(false);
    for (const r of second) offered.add(r.candidate.customerId);
    expect(nextBatch(ranked, offered)).toHaveLength(2);
  });

  it("starts for a time more than two hours ahead", () => {
    const now = new Date("2026-11-18T07:00:00+01:00");
    expect(waitlistStarts(new Date("2026-11-18T09:01:00+01:00"), now)).toBe(true);
    expect(waitlistStarts(new Date("2026-11-18T09:00:00+01:00"), now)).toBe(false);
  });

  it("goes on an hour later, in at most three rounds and until three hours before", () => {
    const sent = new Date("2026-11-17T10:00:00+01:00");
    const far = new Date("2026-11-18T09:00:00+01:00");
    expect(nextRoundAt(1, sent, far)).toEqual(new Date("2026-11-17T11:00:00+01:00"));
    expect(nextRoundAt(2, sent, far)).toEqual(new Date("2026-11-17T11:00:00+01:00"));
    expect(nextRoundAt(3, sent, far)).toBeNull();
    // Three hours before the start is still allowed, a minute later is not.
    const start = new Date("2026-11-17T14:00:00+01:00");
    expect(nextRoundAt(1, sent, start)).toEqual(new Date("2026-11-17T11:00:00+01:00"));
    expect(nextRoundAt(1, new Date("2026-11-17T10:01:00+01:00"), start)).toBeNull();
  });
});
