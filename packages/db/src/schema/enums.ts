import { pgEnum } from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["owner", "admin", "mechanic"]);

export const customerType = pgEnum("customer_type", [
  "private",
  "marina",
  "club",
  "rental",
  "yard",
]);

export const boatStatus = pgEnum("boat_status", ["active", "sold"]);

export const ownershipRole = pgEnum("ownership_role", ["owner", "co_owner", "contact"]);

export const enginePosition = pgEnum("engine_position", ["port", "stbd", "single"]);

export const engineType = pgEnum("engine_type", ["inboard", "outboard", "sterndrive", "jet"]);

export const engineFuel = pgEnum("engine_fuel", ["petrol", "diesel", "electric"]);

export const hoursSource = pgEnum("hours_source", ["mechanic", "customer", "ai"]);
