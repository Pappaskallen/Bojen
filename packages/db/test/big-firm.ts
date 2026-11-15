import { sql } from "drizzle-orm";
import { tenant } from "../src/schema";
import type { Tx } from "./helpers";

export const CUSTOMERS = 5000;

/** The tables whose triggers keep `customer_search` up to date. */
const SEARCH_TABLES = [
  "customer",
  "boat_ownership",
  "boat",
  "engine",
  "drive",
  "boat_placement",
  "location",
];
export const NOW = new Date("2026-11-16T12:00:00Z");

/**
 * 5 000 customers, each with a boat, an engine, a drive (every other one), a place at one
 * of 20 marinas and an ownership. Numbered 1–5000 in every text so a search can find one.
 */
export async function bigFirm(tx: Tx): Promise<string> {
  const [t] = await tx.insert(tenant).values({ name: "Stor firma" }).returning();
  const tenantId = t!.id;
  // The bulk load fills the search texts in one pass at the end, as the migration does, instead
  // of one trigger per row.
  for (const table of SEARCH_TABLES) {
    await tx.execute(sql.raw(`alter table ${table} disable trigger user`));
  }
  await tx.execute(sql`
    create temp table seq on commit drop as
    select n, gen_random_uuid() as customer_id, gen_random_uuid() as boat_id,
           gen_random_uuid() as engine_id
    from generate_series(1, ${CUSTOMERS}) n`);
  await tx.execute(sql`
    create temp table marinas on commit drop as
    select n, gen_random_uuid() as id from generate_series(1, 20) n`);
  await tx.execute(sql`
    insert into location (id, tenant_id, type, name, position)
    select id, ${tenantId}, 'marina', 'Marina ' || lpad(n::text, 2, '0'),
           ST_SetSRID(ST_MakePoint(18 + n / 100.0, 59.3), 4326)::geography
    from marinas`);
  await tx.execute(sql`
    insert into customer (id, tenant_id, name, phone, email)
    select customer_id, ${tenantId},
           (array['Anna','Per','Lars','Eva','Olof','Karin','Nils','Maja'])[1 + n % 8]
             || ' ' || (array['Andersson','Berg','Ek','Holm','Lind'])[1 + n % 5]
             || ' ' || lpad(n::text, 5, '0'),
           '+4670' || lpad(n::text, 7, '0'),
           'kund' || n || '@exempel.test'
    from seq`);
  await tx.execute(sql`
    insert into boat (id, tenant_id, name, make, model, registration_number)
    select boat_id, ${tenantId}, 'Båten ' || lpad(n::text, 5, '0'),
           (array['Nimbus','Targa','Linjett','Aquador','Axopar'])[1 + n % 5],
           (array['3000','28','34','27','37'])[1 + n % 5],
           'SXK-' || lpad(n::text, 5, '0')
    from seq`);
  await tx.execute(sql`
    insert into boat_ownership (tenant_id, boat_id, customer_id)
    select ${tenantId}, boat_id, customer_id from seq`);
  await tx.execute(sql`
    insert into engine (id, tenant_id, boat_id, make, model, serial_number)
    select engine_id, ${tenantId}, boat_id,
           (array['Volvo Penta','Yamaha','Suzuki'])[1 + n % 3],
           (array['D3-220','F150','DF140'])[1 + n % 3],
           'SN-' || lpad(n::text, 7, '0')
    from seq`);
  await tx.execute(sql`
    insert into drive (tenant_id, engine_id, type, serial_number)
    select ${tenantId}, engine_id, 'DPH', 'DRV-' || lpad(n::text, 7, '0')
    from seq where n % 2 = 0`);
  await tx.execute(sql`
    insert into boat_placement
      (tenant_id, boat_id, location_id, season, mode, haul_out_date, launch_date)
    select ${tenantId}, s.boat_id, m.id, 'winter', 'land', '2026-10-15', '2027-05-01'
    from seq s join marinas m on m.n = 1 + s.n % 20`);
  await tx.execute(
    sql`select refresh_customer_search(tenant_id, id) from customer where tenant_id = ${tenantId}`,
  );
  for (const table of SEARCH_TABLES) {
    await tx.execute(sql.raw(`alter table ${table} enable trigger user`));
  }
  // As after the first night: the planner has seen the data.
  await tx.execute(
    sql`analyze customer, customer_search, boat, boat_ownership, engine, drive, location, boat_placement`,
  );
  return tenantId;
}
