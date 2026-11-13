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

export const jobChannel = pgEnum("job_channel", [
  "phone",
  "web",
  "campaign",
  "marina",
  /** A time freed by a cancellation and taken from the waitlist (F4, step 4.3). */
  "waitlist",
]);

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

export const messageChannel = pgEnum("message_channel", ["sms", "email", "push"]);

export const messageDirection = pgEnum("message_direction", ["inbound", "outbound"]);

export const messageStatus = pgEnum("message_status", [
  "queued",
  "sent",
  "delivered",
  "failed",
  "received",
  /** Never sent: the number replied STOPP, or there was no address (step 3.1). */
  "blocked",
]);

/** What an inbound reply means (step 3.2, `ReplyIntent` in core). "other" is no longer used. */
export const messageIntent = pgEnum("message_intent", [
  "yes",
  "no",
  "change",
  "other",
  "stop",
  "another_time",
  "rating",
  "sold",
  "call_me",
  "info",
  "unclear",
]);

export const callOutcome = pgEnum("call_outcome", ["booked", "message", "transferred", "spam"]);

export const taskType = pgEnum("task_type", [
  "call_back",
  "change_request",
  "unclear_reply",
  "low_csat",
  "emergency",
  "parts_arrived",
]);

export const taskStatus = pgEnum("task_status", ["open", "done", "cancelled"]);

export const taskPriority = pgEnum("task_priority", ["normal", "high"]);

export const waitlistStatus = pgEnum("waitlist_status", [
  "waiting",
  "offered",
  "booked",
  "cancelled",
  "expired",
]);

export const campaignStatus = pgEnum("campaign_status", [
  "draft",
  "scheduled",
  "sending",
  "done",
  "cancelled",
]);

export const campaignRecipientStatus = pgEnum("campaign_recipient_status", [
  "pending",
  "sent",
  "booked",
  "declined",
  "no_reply",
]);

export const consentType = pgEnum("consent_type", [
  "marketing_sms",
  "marketing_email",
  "call_recording",
]);

export const consentStatus = pgEnum("consent_status", ["granted", "withdrawn"]);

/** Which customers an approval rule is for (W5). */
export const customerKind = pgEnum("customer_kind", ["new", "existing"]);

/** How a booking from the customer is confirmed (W5). */
export const approvalMode = pgEnum("approval_mode", ["auto", "manual"]);
