/**
 * Saving a new firm's customer list (Avslutande kontroll, onboarding). The list is read and
 * checked in `@bojen/core/onboarding`; this saves the plan in one transaction, so a list is in
 * the system whole or not at all. A customer whose mobile number or e-mail is already in the
 * firm's register is left as it is and reported, so the same list can be read twice.
 */
import {
  seasonDates,
  type ImportCustomer,
  type ImportPlace,
  type ImportPlan,
} from "@bojen/core/onboarding";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "./client";
import {
  boat,
  boatOwnership,
  boatPlacement,
  consent,
  customer,
  engine,
  engineHoursReading,
  location,
} from "./schema";

type Db = Pick<Database, "select" | "transaction">;

/** The places a row may name: the firm's marinas, clubs and yards by name. */
export async function importPlaces(
  db: Pick<Database, "select">,
  tenantId: string,
): Promise<ImportPlace[]> {
  return db
    .select({ id: location.id, name: location.name })
    .from(location)
    .where(and(eq(location.tenantId, tenantId), isNull(location.deletedAt)));
}

export interface ImportResult {
  customers: number;
  boats: number;
  engines: number;
  placements: number;
  /** Customers already in the register, by their row in the sheet. */
  skipped: { row: number; name: string }[];
}

export async function saveCustomerImport(
  db: Db,
  tenantId: string,
  plan: ImportPlan,
  now: Date,
): Promise<ImportResult> {
  if (plan.problems.some((p) => p.level === "error")) {
    throw new Error("The list has errors; fix them before saving.");
  }
  return db.transaction(async (tx) => {
    const phones = plan.customers.flatMap((c) => (c.phone ? [c.phone] : []));
    const emails = plan.customers.flatMap((c) => (c.email ? [c.email] : []));
    const known = async (
      column: typeof customer.phone | typeof customer.email,
      values: string[],
    ) =>
      values.length === 0
        ? new Set<string>()
        : new Set(
            (
              await tx
                .select({ value: column })
                .from(customer)
                .where(
                  and(
                    eq(customer.tenantId, tenantId),
                    isNull(customer.deletedAt),
                    inArray(column, values),
                  ),
                )
            ).flatMap((r) => (r.value ? [r.value.toLowerCase()] : [])),
          );
    const knownPhones = await known(customer.phone, phones);
    const knownEmails = await known(customer.email, emails);
    const isKnown = (c: ImportCustomer) =>
      c.phone ? knownPhones.has(c.phone.toLowerCase()) : c.email ? knownEmails.has(c.email) : false;

    const result: ImportResult = { customers: 0, boats: 0, engines: 0, placements: 0, skipped: [] };
    for (const c of plan.customers) {
      if (isKnown(c)) {
        result.skipped.push({ row: c.row, name: c.name });
        continue;
      }
      const [created] = await tx
        .insert(customer)
        .values({
          tenantId,
          type: c.type,
          name: c.name,
          phone: c.phone,
          email: c.email,
          billingAddress: c.billingAddress,
          acquisitionChannel: "import",
        })
        .returning({ id: customer.id });
      if (!created) throw new Error("customer not created");
      result.customers++;
      if (c.marketingSms) {
        await tx.insert(consent).values({
          tenantId,
          customerId: created.id,
          type: "marketing_sms",
          status: "granted",
          recordedAt: now,
          source: "import",
        });
      }

      for (const b of c.boats) {
        const [newBoat] = await tx
          .insert(boat)
          .values({
            tenantId,
            name: b.name,
            make: b.make,
            model: b.model,
            year: b.year,
            lengthM: b.lengthM,
            registrationNumber: b.registrationNumber,
          })
          .returning({ id: boat.id });
        if (!newBoat) throw new Error("boat not created");
        result.boats++;
        await tx
          .insert(boatOwnership)
          .values({ tenantId, boatId: newBoat.id, customerId: created.id });

        if (b.engine) {
          const e = b.engine;
          const [newEngine] = await tx
            .insert(engine)
            .values({
              tenantId,
              boatId: newBoat.id,
              make: e.make,
              model: e.model,
              type: e.type,
              fuel: e.fuel,
              modelYear: e.modelYear,
              serialNumber: e.serialNumber,
            })
            .returning({ id: engine.id });
          if (!newEngine) throw new Error("engine not created");
          result.engines++;
          if (e.hours !== null) {
            // The firm's own records: as good as the mechanic's reading.
            await tx.insert(engineHoursReading).values({
              tenantId,
              engineId: newEngine.id,
              hours: String(e.hours),
              readAt: now,
              source: "mechanic",
            });
          }
        }

        const dates = seasonDates(b.launchDate, b.haulOutDate);
        if (b.summer) {
          await tx.insert(boatPlacement).values({
            tenantId,
            boatId: newBoat.id,
            locationId: b.summer.locationId,
            season: "summer",
            mode: "water",
            spotId: b.summer.spotId,
            ...dates.summer,
          });
          result.placements++;
        }
        if (b.winter) {
          await tx.insert(boatPlacement).values({
            tenantId,
            boatId: newBoat.id,
            locationId: b.winter.locationId,
            season: "winter",
            mode: b.winter.mode,
            ...dates.winter,
          });
          result.placements++;
        }
      }
    }
    return result;
  });
}
