import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { auditLog, campaignRecipient, consent, survey } from "../src/schema";
import {
  asTenantUser,
  closeDb,
  createTenantWithBoat,
  db,
  expectDbError,
  withRollback,
} from "./helpers";

afterAll(closeDb);

/** Columns of every index on a table, in order, keyed by index name. */
async function indexColumns(table: string): Promise<Record<string, string[]>> {
  const rows = await db.execute<{ name: string; columns: string[] }>(sql`
    select i.relname as name,
           array_agg(a.attname order by k.ord) as columns
    from pg_index x
    join pg_class t on t.oid = x.indrelid
    join pg_class i on i.oid = x.indexrelid
    join pg_namespace n on n.oid = t.relnamespace
    cross join lateral unnest(x.indkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
    where n.nspname = 'public' and t.relname = ${table}
    group by i.relname
  `);
  return Object.fromEntries(rows.map((r) => [r.name, r.columns]));
}

describe("communication and automation (step 1.4)", () => {
  it("has the indexes for the customer's messages and the task list", async () => {
    expect(Object.values(await indexColumns("message"))).toContainEqual([
      "tenant_id",
      "customer_id",
      "created_at",
    ]);
    expect(Object.values(await indexColumns("task"))).toContainEqual([
      "tenant_id",
      "status",
      "due_at",
    ]);
  });

  it("keeps the audit log append-only for signed-in users", async () => {
    await withRollback(async (tx) => {
      const a = await createTenantWithBoat(tx, "A", "+46700000001");
      await asTenantUser(tx, a.tenantId);

      await tx.insert(auditLog).values({
        tenantId: a.tenantId,
        action: "access_code_viewed",
        subjectType: "visit",
        subjectId: a.visitId,
      });
      const own = await tx.select().from(auditLog).where(eq(auditLog.tenantId, a.tenantId));
      expect(own).toHaveLength(2);

      // Without update or delete policies the rows are invisible to those statements.
      const changed = await tx
        .update(auditLog)
        .set({ action: "nothing_happened" })
        .where(eq(auditLog.tenantId, a.tenantId))
        .returning();
      const removed = await tx
        .delete(auditLog)
        .where(eq(auditLog.tenantId, a.tenantId))
        .returning();
      expect({ changed: changed.length, removed: removed.length }).toEqual({
        changed: 0,
        removed: 0,
      });
      const after = await tx.select().from(auditLog).where(eq(auditLog.tenantId, a.tenantId));
      expect(after.map((r) => r.action)).toEqual(["access_code_viewed", "access_code_viewed"]);
    });
  });

  it("records consent changes as new rows and finds the one that applies", async () => {
    await withRollback(async (tx) => {
      const { tenantId, customerId } = await createTenantWithBoat(tx, "A", "+46700000001");
      await tx.insert(consent).values({
        tenantId,
        customerId,
        type: "marketing_sms",
        status: "withdrawn",
        source: "sms_stop",
        recordedAt: new Date(Date.now() + 1000),
      });
      const [latest] = await tx
        .select({ status: consent.status, source: consent.source })
        .from(consent)
        .where(eq(consent.customerId, customerId))
        .orderBy(sql`${consent.recordedAt} desc`)
        .limit(1);
      expect(latest).toEqual({ status: "withdrawn", source: "sms_stop" });
    });
  });

  it("rejects a survey score outside 1–5 and a second survey for the same visit", async () => {
    await withRollback(async (tx) => {
      const { tenantId, visitId } = await createTenantWithBoat(tx, "A", "+46700000001");
      const outOfRange = await expectDbError(tx, (sp) =>
        sp.update(survey).set({ score: 6 }).where(eq(survey.visitId, visitId)),
      );
      expect(String(outOfRange.cause ?? outOfRange)).toMatch(/survey_score_range/);

      const second = await expectDbError(tx, (sp) =>
        sp.insert(survey).values({ tenantId, visitId }),
      );
      expect(String(second.cause ?? second)).toMatch(/survey_visit_id_key/);
    });
  });

  it("adds a boat to a campaign only once", async () => {
    await withRollback(async (tx) => {
      const { tenantId, customerId, boatId } = await createTenantWithBoat(tx, "A", "+46700000001");
      const [existing] = await tx
        .select()
        .from(campaignRecipient)
        .where(eq(campaignRecipient.tenantId, tenantId));
      const again = await expectDbError(tx, (sp) =>
        sp
          .insert(campaignRecipient)
          .values({ tenantId, campaignId: existing!.campaignId, customerId, boatId }),
      );
      expect(String(again.cause ?? again)).toMatch(/campaign_recipient_once_key/);
    });
  });
});
