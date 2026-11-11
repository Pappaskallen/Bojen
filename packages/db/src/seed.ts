/**
 * Realistic demo data for local development and tests (byggplan step 1.5).
 *
 * - The firm "Jonas Båtservice" with 2 mechanics.
 * - The marinas Bullandö, Djurö Båtvarv, Saltsjöbadens BK and Sandhamn (guest harbour).
 * - 40 customers and 45 boats with mixed makes, engines and seasonal placements.
 * - Last season's visits (spring service and winter lay-up 2026), needed for campaigns.
 * - A second, small firm for isolation tests.
 *
 * Everything is fictional. Phone numbers come from the range 070-174 06 05 – 070-174 06 99,
 * which PTS reserves for fiction. The data is deterministic: the same seed gives the same rows.
 *
 * Run with `pnpm db:seed`. It empties every table in the local database first and refuses
 * to run against anything but localhost.
 */
import { sql } from "drizzle-orm";
import { pathToFileURL } from "node:url";
import { connect, type Database } from "./client";
import { databaseUrl } from "./config";
import {
  appUser,
  area,
  boat,
  boatOwnership,
  boatPlacement,
  customer,
  drive,
  engine,
  engineHoursReading,
  job,
  jobLine,
  location,
  locationAccessRule,
  serviceType,
  tenant,
  visit,
  workSchedule,
} from "./schema";
import { timeRange, type LngLat } from "./schema/_types";

type Writer = Pick<Database, "insert" | "execute">;

/** Fixed ids so that tests and the admin can find the demo firms. */
export const DEMO_TENANT_ID = "00000000-0000-4000-8000-000000000001";
export const OTHER_TENANT_ID = "00000000-0000-4000-8000-000000000002";

/** The marinas with approximate positions (WGS 84). Not yet checked against a map service. */
export const DEMO_MARINAS = {
  bullando: { name: "Bullandö Marina", position: { lng: 18.6486, lat: 59.2969 } },
  djuro: { name: "Djurö Båtvarv", position: { lng: 18.6964, lat: 59.3122 } },
  saltsjobaden: { name: "Saltsjöbadens Båtklubb", position: { lng: 18.3036, lat: 59.2803 } },
  sandhamn: { name: "Sandhamns gästhamn", position: { lng: 18.9105, lat: 59.2885 } },
} satisfies Record<string, { name: string; position: LngLat }>;

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`No item at index ${String(index)}`);
  return item;
}

function take<T>(generator: Generator<T>): T {
  const { value, done } = generator.next();
  if (done) throw new Error("Generator ran out of values");
  return value;
}

/** Mulberry32: a small, deterministic pseudo-random generator. */
function random(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(items: readonly T[]): T => at(items, Math.floor(next() * items.length));
  const between = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  return { next, pick, between };
}

/** A fictional mobile number from the PTS range for fiction (070-174 06 05 + n). */
export function fictionalMobile(n: number): string {
  if (n < 0 || n > 94) throw new Error("Only 95 fictional numbers exist");
  return `+4670174${String(605 + n).padStart(4, "0")}`;
}

const FIRST_NAMES = [
  "Anna",
  "Per",
  "Karin",
  "Lars",
  "Maria",
  "Erik",
  "Eva",
  "Johan",
  "Lena",
  "Anders",
  "Sara",
  "Magnus",
  "Kristina",
  "Mikael",
  "Helena",
  "Fredrik",
  "Ulla",
  "Peter",
  "Ingrid",
  "Henrik",
] as const;
const LAST_NAMES = [
  "Andersson",
  "Johansson",
  "Karlsson",
  "Nilsson",
  "Eriksson",
  "Larsson",
  "Olsson",
  "Persson",
  "Svensson",
  "Gustafsson",
  "Lindqvist",
  "Ek",
  "Berg",
  "Holm",
  "Sjöberg",
  "Wikström",
] as const;
const BOAT_NAMES = [
  "Solvik",
  "Vinga",
  "Bris",
  "Måsen",
  "Tärnan",
  "Skäret",
  "Sälen",
  "Ejdern",
  "Nocturne",
  "Saga",
  "Freja",
  "Lyckan",
  "Havsörn",
  "Kobben",
  "Fyren",
] as const;

/** Boat models with a typical engine (make, model, type, fuel, drive). */
const BOAT_MODELS = [
  {
    make: "Nimbus",
    model: "305 Coupé",
    lengthM: "9.70",
    engine: ["Volvo Penta", "D4-300", "inboard", "diesel", "IPS"],
  },
  {
    make: "Buster",
    model: "Magnum Pro",
    lengthM: "6.65",
    engine: ["Yamaha", "F150", "outboard", "petrol", null],
  },
  {
    make: "Buster",
    model: "XL",
    lengthM: "5.25",
    engine: ["Yamaha", "F60", "outboard", "petrol", null],
  },
  {
    make: "Yamarin",
    model: "63 DC",
    lengthM: "6.30",
    engine: ["Yamaha", "F150", "outboard", "petrol", null],
  },
  {
    make: "Bayliner",
    model: "VR6",
    lengthM: "6.50",
    engine: ["Mercruiser", "4.5L", "sterndrive", "petrol", "Alpha One"],
  },
  {
    make: "Hallberg-Rassy",
    model: "31",
    lengthM: "9.40",
    engine: ["Volvo Penta", "D2-40", "inboard", "diesel", "Saildrive 130"],
  },
  {
    make: "Linjett",
    model: "33",
    lengthM: "10.00",
    engine: ["Volvo Penta", "D2-30", "inboard", "diesel", "Saildrive 130"],
  },
  {
    make: "Princess",
    model: "V39",
    lengthM: "12.00",
    engine: ["Volvo Penta", "D6-370", "sterndrive", "diesel", "DPH"],
  },
  {
    make: "Ryds",
    model: "550 VI",
    lengthM: "5.50",
    engine: ["Suzuki", "DF70A", "outboard", "petrol", null],
  },
  {
    make: "Uttern",
    model: "S60",
    lengthM: "6.00",
    engine: ["Mercury", "F115", "outboard", "petrol", null],
  },
  {
    make: "Anytec",
    model: "A27",
    lengthM: "8.30",
    engine: ["Mercury", "Verado 300", "outboard", "petrol", null],
  },
  {
    make: "Grand",
    model: "Golden Line G580",
    lengthM: "5.80",
    engine: ["Suzuki", "DF115B", "outboard", "petrol", null],
  },
  {
    make: "Askeladden",
    model: "C61 Cruiser",
    lengthM: "6.10",
    engine: ["Evinrude", "E-TEC 115", "outboard", "petrol", null],
  },
  {
    make: "Storebro",
    model: "Royal Cruiser 34",
    lengthM: "10.50",
    engine: ["Volvo Penta", "TAMD41", "inboard", "diesel", null],
  },
  {
    make: "Flipper",
    model: "640 ST",
    lengthM: "6.40",
    engine: ["Mercury", "F150", "outboard", "petrol", null],
  },
] as const;

/** Stockholm is UTC+2 from 29 March to 25 October 2026. */
const stockholmSummer = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+02:00`);

/** Working-day slots of two hours, one mechanic at a time, so no visits overlap. */
function* slots(firstDay: string) {
  const day = new Date(`${firstDay}T12:00:00Z`);
  for (;;) {
    const weekday = day.getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      const iso = day.toISOString().slice(0, 10);
      for (const [from, to] of [
        ["08:00", "10:00"],
        ["10:30", "12:30"],
        ["13:30", "15:30"],
      ] as const) {
        yield { day: iso, start: stockholmSummer(iso, from), end: stockholmSummer(iso, to) };
      }
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
}

async function insertOne<T>(rows: Promise<T[]>): Promise<T> {
  const [row] = await rows;
  if (!row) throw new Error("insert returned no row");
  return row;
}

/** Inserts the demo firm, its customers, boats and last season. Runs as the owner. */
export async function seedDemoData(db: Writer, seed = 2026) {
  const rnd = random(seed);
  const tenantId = DEMO_TENANT_ID;

  await db.insert(tenant).values({
    id: tenantId,
    name: "Jonas Båtservice",
    orgNumber: "556000-0000",
    phone: "+46846500400", // PTS range for fiction, 08-46 50 04 00
  });
  const [jonas, elin] = await db
    .insert(appUser)
    .values([
      { tenantId, name: "Jonas Ek", role: "owner", mobile: fictionalMobile(90) },
      { tenantId, name: "Elin Berg", role: "mechanic", mobile: fictionalMobile(91) },
    ])
    .returning();
  if (!jonas || !elin) throw new Error("mechanics not created");

  // Jonas works weekdays 07–12 and 12:30–17; Elin 07–16 and Saturdays in May.
  await db.insert(workSchedule).values([
    ...[1, 2, 3, 4, 5].flatMap((weekday) => [
      { tenantId, userId: jonas.id, weekday, startTime: "07:00", endTime: "12:00" },
      { tenantId, userId: jonas.id, weekday, startTime: "12:30", endTime: "17:00" },
    ]),
    ...[1, 2, 3, 4, 5].map((weekday) => ({
      tenantId,
      userId: elin.id,
      weekday,
      startTime: "07:00",
      endTime: "16:00",
    })),
    {
      tenantId,
      userId: elin.id,
      weekday: 6,
      startTime: "08:00",
      endTime: "14:00",
      validFrom: "2027-05-01",
      validTo: "2027-05-31",
    },
  ]);

  // The yard and the club are customers too: they own their location and can book.
  const djuroYard = await insertOne(
    db
      .insert(customer)
      .values({ tenantId, type: "yard", name: "Djurö Båtvarv AB", phone: fictionalMobile(92) })
      .returning(),
  );
  const sbk = await insertOne(
    db
      .insert(customer)
      .values({
        tenantId,
        type: "club",
        name: "Saltsjöbadens Båtklubb",
        phone: fictionalMobile(93),
      })
      .returning(),
  );

  const varmdo = await insertOne(
    db
      .insert(area)
      .values({
        tenantId,
        name: "Värmdö och Sandhamn",
        boundary: [
          [
            { lng: 18.5, lat: 59.2 },
            { lng: 19.0, lat: 59.2 },
            { lng: 19.0, lat: 59.4 },
            { lng: 18.5, lat: 59.4 },
            { lng: 18.5, lat: 59.2 },
          ],
        ],
      })
      .returning(),
  );
  const nacka = await insertOne(
    db
      .insert(area)
      .values({
        tenantId,
        name: "Nacka och Saltsjöbaden",
        boundary: [
          [
            { lng: 18.15, lat: 59.22 },
            { lng: 18.5, lat: 59.22 },
            { lng: 18.5, lat: 59.36 },
            { lng: 18.15, lat: 59.36 },
            { lng: 18.15, lat: 59.22 },
          ],
        ],
      })
      .returning(),
  );

  const m = DEMO_MARINAS;
  const [bullando, djuro, saltsjobaden, sandhamn] = await db
    .insert(location)
    .values([
      {
        tenantId,
        type: "marina",
        ...m.bullando,
        address: "Bullandö, 139 56 Värmdö",
        areaId: varmdo.id,
      },
      {
        tenantId,
        type: "yard",
        ...m.djuro,
        address: "Djurö, 139 73 Djurhamn",
        ownerCustomerId: djuroYard.id,
        areaId: varmdo.id,
      },
      {
        tenantId,
        type: "club",
        ...m.saltsjobaden,
        address: "Saltsjöbaden, 133 30 Saltsjöbaden",
        ownerCustomerId: sbk.id,
        areaId: nacka.id,
      },
      {
        tenantId,
        type: "marina",
        ...m.sandhamn,
        address: "Sandhamn, 130 39 Sandhamn",
        accessMethod: "ferry",
        crossingMinutes: 50,
        areaId: varmdo.id,
      },
    ])
    .returning();
  if (!bullando || !djuro || !saltsjobaden || !sandhamn) throw new Error("marinas not created");

  await db.insert(locationAccessRule).values([
    {
      tenantId,
      locationId: bullando.id,
      openingHours: { weekdays: "07-19", weekend: "08-17" },
      checkInInstructions: "Anmäl dig i marinakontoret.",
      parking: "Stora parkeringen vid infarten.",
    },
    {
      tenantId,
      locationId: djuro.id,
      openingHours: { weekdays: "07-16" },
      checkInInstructions: "Ring varvet innan du kommer.",
      parking: "Vid hallarna.",
    },
  ]);

  const [spring, layUp] = await db
    .insert(serviceType)
    .values([
      {
        tenantId,
        name: "Vårservice och sjösättningskontroll",
        defaultDurationMinutes: 120,
        priceOre: 245_000,
        preparationText: "Se till att båten är tillgänglig och att nyckeln finns på plats.",
      },
      {
        tenantId,
        name: "Vinterkonservering",
        defaultDurationMinutes: 120,
        requiredMode: "land",
        priceOre: 275_000,
      },
      { tenantId, name: "Felsökning", defaultDurationMinutes: 60, priceOre: 95_000 },
    ])
    .returning();
  if (!spring || !layUp) throw new Error("service types not created");

  // 40 private customers; the first five own two boats each, which gives 45 boats.
  const customers = await db
    .insert(customer)
    .values(
      Array.from({ length: 40 }, (_, i) => ({
        tenantId,
        type: "private" as const,
        name: `${at(FIRST_NAMES, i % FIRST_NAMES.length)} ${rnd.pick(LAST_NAMES)}`,
        phone: fictionalMobile(i),
        acquisitionChannel: rnd.pick(["phone", "web", "marina", "recommendation"]),
      })),
    )
    .returning();

  const summerMarinas = [bullando, bullando, saltsjobaden, sandhamn, djuro];
  const winterYards = [djuro, bullando];
  const jonasSlots = { spring: slots("2026-04-13"), autumn: slots("2026-09-21") };
  const elinSlots = { spring: slots("2026-04-13"), autumn: slots("2026-09-21") };

  let boatCount = 0;
  for (const [i, owner] of customers.entries()) {
    const boatsForCustomer = i < 5 ? 2 : 1;
    for (let k = 0; k < boatsForCustomer; k++) {
      const model = at(BOAT_MODELS, boatCount % BOAT_MODELS.length);
      boatCount++;
      const b = await insertOne(
        db
          .insert(boat)
          .values({
            tenantId,
            name: rnd.pick(BOAT_NAMES),
            make: model.make,
            model: model.model,
            lengthM: model.lengthM,
            year: rnd.between(1998, 2024),
          })
          .returning(),
      );
      await db.insert(boatOwnership).values({ tenantId, boatId: b.id, customerId: owner.id });

      const [engineMake, engineModel, engineType, fuel, driveType] = model.engine;
      const e = await insertOne(
        db
          .insert(engine)
          .values({
            tenantId,
            boatId: b.id,
            make: engineMake,
            model: engineModel,
            type: engineType,
            fuel,
          })
          .returning(),
      );
      if (driveType) await db.insert(drive).values({ tenantId, engineId: e.id, type: driveType });

      const summer = rnd.pick(summerMarinas);
      const winter = rnd.pick(winterYards);
      await db.insert(boatPlacement).values([
        {
          tenantId,
          boatId: b.id,
          locationId: summer.id,
          season: "summer",
          mode: "water",
          spotId: `${rnd.pick(["A", "B", "C"])}${String(rnd.between(1, 60))}`,
          launchDate: "2026-05-02",
          haulOutDate: "2026-10-10",
        },
        {
          tenantId,
          boatId: b.id,
          locationId: winter.id,
          season: "winter",
          mode: winter.id === djuro.id && rnd.next() < 0.5 ? "indoor" : "land",
          spotId: `Rad ${String(rnd.between(1, 8))}`,
          haulOutDate: "2026-10-10",
          launchDate: "2027-05-01",
        },
      ]);

      // Last season: everyone had a spring service; most also had their boat laid up.
      const mechanic = boatCount % 2 === 0 ? jonas : elin;
      const calendar = mechanic === jonas ? jonasSlots : elinSlots;
      const hours = rnd.between(80, 1400);
      const visits = [{ service: spring, slot: take(calendar.spring), hours }];
      if (rnd.next() < 0.75) {
        visits.push({
          service: layUp,
          slot: take(calendar.autumn),
          hours: hours + rnd.between(20, 90),
        });
      }
      for (const { service, slot, hours: readHours } of visits) {
        const j = await insertOne(
          db
            .insert(job)
            .values({
              tenantId,
              customerId: owner.id,
              boatId: b.id,
              serviceTypeId: service.id,
              pipelineStatus: "paid",
              channel: rnd.pick(["phone", "web", "campaign"] as const),
              description: service.name,
            })
            .returning(),
        );
        await db.insert(visit).values({
          tenantId,
          jobId: j.id,
          mechanicId: mechanic.id,
          timeWindow: timeRange(slot.start, slot.end),
          plannedMinutes: service.defaultDurationMinutes,
          status: "done",
          availabilityStatus: "confirmed",
        });
        await db.insert(jobLine).values({
          tenantId,
          jobId: j.id,
          type: "labour",
          description: service.name,
          hours: "2.00",
          unitPriceOre: (service.priceOre ?? 0) / 2,
        });
        await db.insert(engineHoursReading).values({
          tenantId,
          engineId: e.id,
          hours: `${String(readHours)}.0`,
          readAt: slot.start,
          source: "mechanic",
        });
      }
    }
  }

  return {
    tenantId,
    mechanicIds: [jonas.id, elin.id],
    boats: boatCount,
    customers: customers.length,
  };
}

/** A second, small firm so that isolation can be checked against real-looking data. */
export async function seedOtherTenant(db: Writer) {
  const tenantId = OTHER_TENANT_ID;
  await db.insert(tenant).values({ id: tenantId, name: "Skärgårdsmekarna" });
  await db.insert(appUser).values({ tenantId, name: "Kim Holm", role: "owner" });
  const c = await insertOne(
    db
      .insert(customer)
      .values({ tenantId, name: "Ulla Wikström", phone: fictionalMobile(94) })
      .returning(),
  );
  const b = await insertOne(
    db.insert(boat).values({ tenantId, name: "Kobben", make: "Ryds", model: "468" }).returning(),
  );
  await db.insert(boatOwnership).values({ tenantId, boatId: b.id, customerId: c.id });
  return { tenantId };
}

/** Empties every table in the public schema. Only for the local database. */
export async function truncateAll(db: Writer) {
  await db.execute(sql`
    do $$
    declare tables text;
    begin
      select string_agg(format('%I.%I', schemaname, tablename), ', ') into tables
      from pg_tables where schemaname = 'public';
      if tables is not null then execute 'truncate ' || tables || ' cascade'; end if;
    end $$
  `);
}

async function main() {
  const url = databaseUrl();
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(`Refusing to seed ${host}: seeding empties every table and is local only.`);
  }
  const { db, close } = connect(url);
  try {
    const result = await db.transaction(async (tx) => {
      await truncateAll(tx);
      const demo = await seedDemoData(tx);
      await seedOtherTenant(tx);
      return demo;
    });
    console.info(
      `[db] seeded Jonas Båtservice: ${String(result.customers)} customers, ${String(result.boats)} boats`,
    );
  } finally {
    await close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
