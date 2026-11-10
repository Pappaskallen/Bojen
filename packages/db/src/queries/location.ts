import { and, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "../client";
import { boatPlacement, location } from "../schema";

/** Anything that can run a select: the database or an open transaction. */
export type Queryable = Pick<Database, "select">;

/**
 * The placement that applies to a boat on a date (`YYYY-MM-DD`, Swedish calendar day),
 * with its location. Returns `undefined` when the boat has no placement for that day.
 */
export async function placementOn(db: Queryable, boatId: string, day: string) {
  const [row] = await db
    .select({ placement: boatPlacement, location })
    .from(boatPlacement)
    .innerJoin(location, eq(location.id, boatPlacement.locationId))
    .where(
      and(
        eq(boatPlacement.boatId, boatId),
        isNull(boatPlacement.deletedAt),
        sql`${boatPlacement.validDuring} @> ${day}::date`,
      ),
    )
    .limit(1);
  return row;
}

/**
 * Distance in metres along the earth's surface between two locations. Returns `null`
 * when either location is missing or has no position yet.
 */
export async function distanceBetweenLocations(
  db: Queryable,
  fromId: string,
  toId: string,
): Promise<number | null> {
  const to = alias(location, "to_location");
  const [row] = await db
    .select({ metres: sql<string | null>`ST_Distance(${location.position}, ${to.position})` })
    .from(location)
    .innerJoin(to, eq(to.id, toId))
    .where(eq(location.id, fromId));
  return row?.metres == null ? null : Number(row.metres);
}
