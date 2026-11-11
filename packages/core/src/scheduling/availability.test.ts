import { describe, expect, it } from "vitest";
import { stockholmInstant } from "../time";
import {
  availableWindows,
  subtractSpans,
  type AvailabilityInput,
  type BusyInterval,
  type WorkPeriod,
} from "./availability";

const WINDOWS = [
  { start: "08:00", end: "12:00" },
  { start: "12:00", end: "16:00" },
  { start: "16:00", end: "19:00" },
] as const;

/** Jonas works weekdays 07–12 and 12:30–17 (lunch in between). */
const jonas: WorkPeriod[] = [1, 2, 3, 4, 5].flatMap((weekday) => [
  { mechanicId: "jonas", weekday, start: "07:00", end: "12:00" },
  { mechanicId: "jonas", weekday, start: "12:30", end: "17:00" },
]);
/** Elin works weekdays 07–17 without a fixed lunch. */
const elin: WorkPeriod[] = [1, 2, 3, 4, 5].map((weekday) => ({
  mechanicId: "elin",
  weekday,
  start: "07:00",
  end: "17:00",
}));

const SUMMER_TUESDAY = "2027-06-15"; // UTC+2
const WINTER_TUESDAY = "2027-01-19"; // UTC+1
const at = stockholmInstant;
const busy = (mechanicId: string, day: string, from: string, to: string): BusyInterval => ({
  mechanicId,
  start: at(day, from),
  end: at(day, to),
});

const hhmm = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  hour: "2-digit",
  minute: "2-digit",
});

function run(overrides: Partial<AvailabilityInput>) {
  const input: AvailabilityInput = {
    from: SUMMER_TUESDAY,
    to: SUMMER_TUESDAY,
    durationMinutes: 120,
    bufferMinutes: 15,
    windows: WINDOWS,
    schedule: jonas,
    blocks: [],
    visits: [],
    now: new Date("2027-01-01T00:00:00Z"),
    ...overrides,
  };
  return availableWindows(input).map(
    (o) => `${o.mechanicId} ${o.day} ${o.label} @${hhmm.format(o.earliestStart)}`,
  );
}

describe("availableWindows", () => {
  it.each<[string, Partial<AvailabilityInput>, string[]]>([
    [
      "a free day, 2 h service: the late window is too short before 17",
      {},
      ["jonas 2027-06-15 08–12 @08:00", "jonas 2027-06-15 12–16 @12:30"],
    ],
    [
      "a free day, 1 h service: all three windows",
      { durationMinutes: 60 },
      [
        "jonas 2027-06-15 08–12 @08:00",
        "jonas 2027-06-15 12–16 @12:30",
        "jonas 2027-06-15 16–19 @16:00",
      ],
    ],
    [
      "partly booked: 15 min before lunch is too little for 1 h",
      { durationMinutes: 60, visits: [busy("jonas", SUMMER_TUESDAY, "08:00", "11:00")] },
      ["jonas 2027-06-15 12–16 @12:30", "jonas 2027-06-15 16–19 @16:00"],
    ],
    [
      "partly booked: a short job fits after the visit and its buffer",
      { durationMinutes: 30, visits: [busy("jonas", SUMMER_TUESDAY, "08:00", "11:00")] },
      [
        "jonas 2027-06-15 08–12 @11:15",
        "jonas 2027-06-15 12–16 @12:30",
        "jonas 2027-06-15 16–19 @16:00",
      ],
    ],
    [
      "a job may start late in a window and run past its end",
      {
        schedule: elin,
        visits: [busy("elin", SUMMER_TUESDAY, "08:00", "11:00")],
      },
      ["elin 2027-06-15 08–12 @11:15", "elin 2027-06-15 12–16 @12:00"],
    ],
    ["a service longer than any gap", { durationMinutes: 6 * 60 }, []],
    [
      "a service that exactly fills the afternoon",
      { durationMinutes: 270 },
      ["jonas 2027-06-15 12–16 @12:30"],
    ],
    ["the weekend: no schedule on Saturday", { from: "2027-06-19", to: "2027-06-20" }, []],
    [
      "a whole day blocked for holiday",
      { blocks: [busy("jonas", SUMMER_TUESDAY, "00:00", "23:59")] },
      [],
    ],
    [
      "a blocked afternoon hour moves the start",
      { durationMinutes: 60, blocks: [busy("jonas", SUMMER_TUESDAY, "12:30", "15:00")] },
      [
        "jonas 2027-06-15 08–12 @08:00",
        "jonas 2027-06-15 12–16 @15:00",
        "jonas 2027-06-15 16–19 @16:00",
      ],
    ],
    [
      "nothing before now, and starts are rounded up to the quarter",
      { durationMinutes: 60, now: at(SUMMER_TUESDAY, "09:07") },
      [
        "jonas 2027-06-15 08–12 @09:15",
        "jonas 2027-06-15 12–16 @12:30",
        "jonas 2027-06-15 16–19 @16:00",
      ],
    ],
    ["the day is already over", { now: at(SUMMER_TUESDAY, "17:30") }, []],
    [
      "a visit for another mechanic does not block",
      {
        durationMinutes: 60,
        schedule: [...jonas, ...elin],
        visits: [busy("elin", SUMMER_TUESDAY, "07:00", "17:00")],
      },
      [
        "jonas 2027-06-15 08–12 @08:00",
        "jonas 2027-06-15 12–16 @12:30",
        "jonas 2027-06-15 16–19 @16:00",
      ],
    ],
    [
      "a schedule that ended before the day",
      { schedule: jonas.map((p) => ({ ...p, validTo: "2027-05-31" })) },
      [],
    ],
    [
      "a cancelled visit is left out by the caller, so the day is free",
      { visits: [] },
      ["jonas 2027-06-15 08–12 @08:00", "jonas 2027-06-15 12–16 @12:30"],
    ],
  ])("%s", (_name, overrides, expected) => {
    expect(run(overrides)).toEqual(expected);
  });

  it.each([
    ["summer time (UTC+2)", SUMMER_TUESDAY, "2027-06-15T06:00:00.000Z"],
    ["winter time (UTC+1)", WINTER_TUESDAY, "2027-01-19T07:00:00.000Z"],
  ])("puts 08:00 at the right instant in %s", (_name, day, iso) => {
    const [first] = availableWindows({
      from: day,
      to: day,
      durationMinutes: 60,
      bufferMinutes: 15,
      windows: WINDOWS,
      schedule: jonas,
      blocks: [],
      visits: [],
      now: new Date("2027-01-01T00:00:00Z"),
    });
    expect(first?.windowStart.toISOString()).toBe(iso);
    expect(first?.earliestStart.toISOString()).toBe(iso);
  });

  it("handles the days summer time starts and ends", () => {
    const sundays: WorkPeriod[] = [
      { mechanicId: "jonas", weekday: 7, start: "08:00", end: "12:00" },
    ];
    const offers = availableWindows({
      from: "2027-03-27",
      to: "2027-03-28",
      durationMinutes: 60,
      bufferMinutes: 0,
      windows: [{ start: "08:00", end: "12:00" }],
      schedule: sundays,
      blocks: [],
      visits: [],
      now: new Date("2027-01-01T00:00:00Z"),
    });
    // Summer time starts at 02:00 on 28 March, so 08:00 is already UTC+2.
    expect(offers.map((o) => o.earliestStart.toISOString())).toEqual(["2027-03-28T06:00:00.000Z"]);

    const autumn = availableWindows({
      from: "2027-10-31",
      to: "2027-10-31",
      durationMinutes: 60,
      bufferMinutes: 0,
      windows: [{ start: "08:00", end: "12:00" }],
      schedule: sundays,
      blocks: [],
      visits: [],
      now: new Date("2027-01-01T00:00:00Z"),
    });
    // Summer time ends at 03:00 on 31 October, so 08:00 is back to UTC+1.
    expect(autumn.map((o) => o.earliestStart.toISOString())).toEqual(["2027-10-31T07:00:00.000Z"]);
  });

  it("looks at every day in the range and every mechanic", () => {
    const offers = availableWindows({
      from: "2027-06-14",
      to: "2027-06-20",
      durationMinutes: 120,
      bufferMinutes: 15,
      windows: WINDOWS,
      schedule: [...jonas, ...elin],
      blocks: [],
      visits: [],
      now: new Date("2027-01-01T00:00:00Z"),
    });
    // Each weekday: 2 windows each for Jonas and Elin; 16:00 + 2 h runs past 17:00.
    const perDay = new Map<string, number>();
    for (const o of offers) perDay.set(o.day, (perDay.get(o.day) ?? 0) + 1);
    expect([...perDay.keys()]).toEqual([
      "2027-06-14",
      "2027-06-15",
      "2027-06-16",
      "2027-06-17",
      "2027-06-18",
    ]);
    expect([...perDay.values()].every((n) => n === 4)).toBe(true);
  });

  it("refuses a service without length", () => {
    expect(() => run({ durationMinutes: 0 })).toThrow();
  });
});

describe("subtractSpans", () => {
  it.each([
    ["no overlap", [[0, 10]], [[20, 30]], [[0, 10]]],
    [
      "cuts the middle",
      [[0, 10]],
      [[3, 5]],
      [
        [0, 3],
        [5, 10],
      ],
    ],
    ["covers all", [[0, 10]], [[0, 10]], []],
    [
      "trims both ends",
      [[0, 10]],
      [
        [-5, 2],
        [8, 15],
      ],
      [[2, 8]],
    ],
    ["touching ends do not overlap", [[0, 10]], [[10, 20]], [[0, 10]]],
  ])("%s", (_name, free, busySpans, expected) => {
    const toSpans = (list: number[][]) =>
      list.map(([start, end]) => ({ start: start!, end: end! }));
    expect(subtractSpans(toSpans(free), toSpans(busySpans))).toEqual(toSpans(expected));
  });
});
