import { addDays, isoWeekday, stockholmInstant } from "@bojen/core";
import {
  BookingError,
  appUser,
  boat,
  boatOwnership,
  boatPlacement,
  connect,
  createBooking,
  customer,
  databaseUrl,
  location,
  serviceType,
} from "@bojen/db";
import { runMigrations } from "@bojen/db/migrate";
import { DEMO_TENANT_ID, seedDemoData, seedOtherTenant, truncateAll } from "@bojen/db/seed";
import { and, eq } from "drizzle-orm";

export const NEIGHBOUR_PHONE = "+46701740685";

/**
 * Empties the local database, loads the demo data and books a neighbour boat at Bullandö
 * about a week ahead, so the page has a marina day to offer.
 */
export default async function globalSetup(): Promise<void> {
  const url = databaseUrl();
  if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
    throw new Error("The end-to-end tests empty the database and only run against localhost");
  }
  await runMigrations(url);
  const { db, close } = connect(url);
  try {
    await db.transaction(async (tx) => {
      await truncateAll(tx);
      await seedDemoData(tx);
      await seedOtherTenant(tx);
    });

    const tenantId = DEMO_TENANT_ID;
    const [jonas] = await db
      .select()
      .from(appUser)
      .where(and(eq(appUser.tenantId, tenantId), eq(appUser.name, "Jonas Ek")));
    const [bullando] = await db
      .select()
      .from(location)
      .where(and(eq(location.tenantId, tenantId), eq(location.slug, "bullando-marina")));
    const [layUp] = await db
      .select()
      .from(serviceType)
      .where(and(eq(serviceType.tenantId, tenantId), eq(serviceType.name, "Vinterkonservering")));
    if (!jonas || !bullando || !layUp) {
      throw new Error("The demo data is missing Jonas, Bullandö or the service");
    }

    const [neighbour] = await db
      .insert(customer)
      .values({ tenantId, name: "Granne Bullandö", phone: NEIGHBOUR_PHONE })
      .returning();
    const [neighbourBoat] = await db
      .insert(boat)
      .values({ tenantId, name: "Grannbåten" })
      .returning();
    if (!neighbour || !neighbourBoat) throw new Error("The neighbour was not created");
    await db
      .insert(boatOwnership)
      .values({ tenantId, boatId: neighbourBoat.id, customerId: neighbour.id });
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(
      new Date(),
    );
    await db.insert(boatPlacement).values({
      tenantId,
      boatId: neighbourBoat.id,
      locationId: bullando.id,
      season: "winter",
      mode: "land",
      haulOutDate: addDays(today, -30),
    });

    // The first free weekday morning from a week ahead.
    for (let offset = 7; offset < 30; offset++) {
      const day = addDays(today, offset);
      if (isoWeekday(day) > 5) continue;
      try {
        await createBooking(
          { db, now: () => new Date() },
          {
            tenantId,
            actor: { type: "staff", id: jonas.id },
            idempotencyKey: `e2e-neighbour-${day}`,
          },
          {
            customerId: neighbour.id,
            boatId: neighbourBoat.id,
            serviceTypeId: layUp.id,
            mechanicId: jonas.id,
            start: stockholmInstant(day, "08:00"),
            channel: "phone",
            needsApproval: false,
            partsMissing: false,
          },
        );
        return;
      } catch (error) {
        if (!(error instanceof BookingError && error.code === "conflict")) throw error;
      }
    }
    throw new Error("Found no free morning for the neighbour booking");
  } finally {
    await close();
  }
}
