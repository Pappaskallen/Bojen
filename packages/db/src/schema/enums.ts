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

export const locationType = pgEnum("location_type", [
  "marina",
  "club",
  "yard",
  "private_dock",
  "home",
]);

export const accessMethod = pgEnum("access_method", ["car", "boat", "ferry"]);

export const placementSeason = pgEnum("placement_season", ["summer", "winter"]);

export const placementMode = pgEnum("placement_mode", ["water", "land", "indoor"]);

/** The pipeline in the admin (spec C4): inquiry → quote → parts ordered → booked → done → invoiced → paid. */
export const jobPipelineStatus = pgEnum("job_pipeline_status", [
  "inquiry",
  "quote",
  "parts_ordered",
  "booked",
  "done",
  "invoiced",
  "paid",
  "cancelled",
]);

export const jobUrgency = pgEnum("job_urgency", ["planned", "soon", "emergency"]);

export const jobChannel = pgEnum("job_channel", ["phone", "web", "campaign", "marina"]);

export const visitStatus = pgEnum("visit_status", [
  "tentative",
  "pending_approval",
  "booked",
  "confirmed",
  "unconfirmed",
  "in_progress",
  "done",
  "cancelled",
  "no_access",
]);

/** The 24-hour availability check (flow F3). */
export const availabilityStatus = pgEnum("availability_status", [
  "not_sent",
  "skipped",
  "pending",
  "confirmed",
  "declined",
  "change_requested",
  "no_reply",
]);

export const jobLineType = pgEnum("job_line_type", ["labour", "callout", "emergency", "discount"]);

export const jobPartStatus = pgEnum("job_part_status", [
  "needed",
  "ordered",
  "delivered",
  "installed",
]);

export const jobPartSource = pgEnum("job_part_source", ["van", "order"]);
