import { check, foreignKey, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { baseColumns, isE164, tenantIsolationPolicy } from "./_shared";
import { location } from "./location";
import { tenant } from "./tenant";

/**
 * The people at a marina, club or yard (byggplan step 5.3, spec C3): the harbour master, the
 * office, the yard foreman. Contact details only; codes belong in `location_access_rule`,
 * encrypted.
 */
export const locationContact = pgTable(
  "location_contact",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    locationId: uuid("location_id").notNull(),
    name: text("name").notNull(),
    /** What they do there, for example "Hamnkapten". */
    role: text("role"),
    /** E.164. */
    phone: text("phone"),
    email: text("email"),
    note: text("note"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    foreignKey({
      name: "location_contact_location_fk",
      columns: [t.tenantId, t.locationId],
      foreignColumns: [location.tenantId, location.id],
    }),
    check("location_contact_phone_e164", isE164(t.phone)),
    index("location_contact_location_id_idx").on(t.tenantId, t.locationId),
    tenantIsolationPolicy(),
  ],
);
