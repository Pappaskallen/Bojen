import { describe, expect, it } from "vitest";
import { stockholmInstant } from "../time";
import type { WorkPeriod } from "./availability";
import {
  MissingTravelTimeError,
  firstPossibleDay,
  modeSatisfies,
  suggestSlots,
  travelPairsFor,
  type PlannedVisit,
  type SuggestInput,
} from "./suggest";

/** Minutes between places, the same both ways. */
const MINUTES: Record<string, number> = {
  "depot|bullando": 30,
  "depot|djuro": 35,
  "depot|sandhamn": 120,
  "bullando|djuro": 15,
  "bullando|sandhamn": 100,
  "djuro|sandhamn": 90,
};
const travel = (a: string, b: string) => {
  const m = MINUTES[`${a}|${b}`] ?? MINUTES[`${b}|${a}`];
  return m === undefined ? undefined : m * 60;
};

const weekdays = (mechanicId: string): WorkPeriod[] =>
  [1, 2, 3, 4, 5].map((weekday) => ({ mechanicId, weekday, start: "07:00", end: "17:00" }));

const visit = (
  mechanicId: string,
  locationId: string,
  day: string,
  from: string,
  to: string,
): PlannedVisit => ({
  mechanicId,
  locationId,
  start: stockholmInstant(day, from),
  end: stockholmInstant(day, to),
});

const MONDAY = "2027-04-12";
const THURSDAY = "2027-04-15";

function input(
  overrides: Partial<SuggestInput> = {},
  tenant: Partial<SuggestInput["tenant"]> = {},
) {
  return {
    tenant: {
      windows: [
        { start: "08:00", end: "12:00" },
        { start: "12:00", end: "16:00" },
      ],
      bufferMinutes: 15,
      maxExtraDriveMinutes: 90,
      marinaDayDiscount: { kind: "waive_callout" },
      schedule: weekdays("jonas"),
      blocks: [],
      visits: [],
      bases: { jonas: "depot", elin: "depot" },
      ...tenant,
    },
    serviceType: { durationMinutes: 120 },
    location: { id: "bullando" },
    mode: [{ mode: "water" }],
    earliest: MONDAY,
    partsLeadDays: 0,
    travel,
    now: stockholmInstant(MONDAY, "06:00"),
    horizonDays: 14,
    limit: 50,
    ...overrides,
  } satisfies SuggestInput;
}

const brief = (s: ReturnType<typeof suggestSlots>[number]) =>
  `${s.day} ${s.label} ${s.mechanicId} score=${s.score}${s.marinaDay ? " marina" : ""}`;

describe("suggestSlots", () => {
  it("ranks a time at Bullandö on a day with another Bullandö job first", () => {
    const result = suggestSlots(
      input({}, { visits: [visit("jonas", "bullando", THURSDAY, "08:00", "10:00")] }),
    );
    const [top] = result;
    // Thursday: no extra drive (Bullandö → depot replaces the drive home), −30 bonus, 3 days × 2.
    expect(top && brief(top)).toBe("2027-04-15 08–12 jonas score=-24 marina");
    expect(top?.discount).toEqual({ kind: "waive_callout" });
    expect(top?.earliestStart).toEqual(stockholmInstant(THURSDAY, "10:15"));
    // An empty Monday costs the drive there and back: 30 + 30 min.
    expect(result.find((s) => s.day === MONDAY)?.score).toBe(60);
    expect(result.filter((s) => !s.marinaDay).every((s) => s.discount === null)).toBe(true);
  });

  it("never suggests a bellows change before haul-out", () => {
    const now = stockholmInstant("2027-10-01", "06:00");
    const result = suggestSlots(
      input({
        serviceType: { durationMinutes: 180, requiredMode: "land" },
        mode: [
          { mode: "water", to: "2027-10-14" },
          { mode: "land", from: "2027-10-15" },
        ],
        earliest: "2027-10-01",
        now,
        horizonDays: 28,
      }),
    );
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((s) => s.day >= "2027-10-15")).toBe(true);
  });

  it("lets a part with 5 days lead time move the earliest time", () => {
    const days = (lead: number) =>
      suggestSlots(input({ partsLeadDays: lead }))
        .map((s) => s.day)
        .sort();
    expect(days(0)[0]).toBe(MONDAY);
    // Today + 5 + 1 is Sunday 18 April; Jonas works again on Monday.
    expect(firstPossibleDay({ earliest: MONDAY, partsLeadDays: 5, now: input().now })).toBe(
      "2027-04-18",
    );
    expect(days(5)[0]).toBe("2027-04-19");
  });

  it("keeps the drive to and from other jobs free", () => {
    const [first] = suggestSlots(
      input({ limit: 1 }, { visits: [visit("jonas", "djuro", MONDAY, "08:00", "10:00")] }),
    );
    // 10:00 + 15 min buffer + 15 min drive from Djurö.
    expect(first?.day).toBe(MONDAY);
    expect(first?.earliestStart).toEqual(stockholmInstant(MONDAY, "10:30"));
    // Djurö → Bullandö → depot instead of Djurö → depot: 15 + 30 − 35 = 10 min.
    expect(first?.extraDriveMinutes).toBe(10);
  });

  it("hides times that add more driving than the firm allows", () => {
    expect(
      suggestSlots(input({ location: { id: "sandhamn" } }, { maxExtraDriveMinutes: 45 })),
    ).toEqual([]);
    // The same island is fine on a day the mechanic is already there.
    const result = suggestSlots(
      input(
        { location: { id: "sandhamn" } },
        {
          maxExtraDriveMinutes: 45,
          visits: [visit("jonas", "sandhamn", THURSDAY, "08:00", "10:00")],
        },
      ),
    );
    expect(result.map((s) => `${s.day} ${s.label}`)).toEqual([
      "2027-04-15 08–12",
      "2027-04-15 12–16",
    ]);
  });

  it("puts earlier empty days before later ones", () => {
    const result = suggestSlots(input({ limit: 4 }));
    expect(result.map(brief)).toEqual([
      "2027-04-12 08–12 jonas score=60",
      "2027-04-12 12–16 jonas score=60",
      "2027-04-13 08–12 jonas score=62",
      "2027-04-13 12–16 jonas score=62",
    ]);
  });

  it("offers each window once, with the mechanic who is already at the marina", () => {
    const result = suggestSlots(
      input(
        {},
        {
          schedule: [...weekdays("jonas"), ...weekdays("elin")],
          visits: [visit("elin", "bullando", MONDAY, "07:00", "08:00")],
        },
      ),
    );
    const monday = result.filter((s) => s.day === MONDAY);
    expect(monday.map((s) => `${s.label} ${s.mechanicId} ${s.marinaDay}`)).toEqual([
      "08–12 elin true",
      "12–16 elin true",
    ]);
  });

  it("returns at most `limit` suggestions, three by default", () => {
    const withoutLimit: SuggestInput = { ...input() };
    delete withoutLimit.limit;
    expect(suggestSlots(withoutLimit)).toHaveLength(3);
  });

  it("asks for every travel time it needs through travelPairsFor", () => {
    const base = input({}, { visits: [visit("jonas", "djuro", MONDAY, "08:00", "10:00")] });
    const pairs = travelPairsFor(base);
    const asked: string[] = [];
    suggestSlots({
      ...base,
      travel: (a, b) => {
        asked.push(`${a}>${b}`);
        return travel(a, b);
      },
    });
    const offered = new Set(pairs.map((p) => `${p.fromId}>${p.toId}`));
    expect(asked.every((key) => offered.has(key))).toBe(true);

    expect(() => suggestSlots({ ...base, travel: () => undefined })).toThrow(
      MissingTravelTimeError,
    );
  });
});

describe("modeSatisfies", () => {
  it.each([
    [null, "water", true],
    ["land", "land", true],
    ["land", "indoor", true],
    ["land", "water", false],
    ["water", "land", false],
    ["indoor", "land", false],
  ] as const)("requires %s, boat is %s: %s", (required, actual, expected) => {
    expect(modeSatisfies(required, actual)).toBe(expected);
  });
});
