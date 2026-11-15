import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { searchCustomers } from "../src/customers";
import { CUSTOMERS, NOW, bigFirm } from "./big-firm";
import { closeDb, withRollback } from "./helpers";

afterAll(closeDb);

/**
 * The fastest of seven runs, in milliseconds, after one run that warms the cache. The
 * minimum is what the code costs; the slower runs are the machine (a laptop with Docker
 * running), which varies several times over from one second to the next.
 */
async function fastest(run: () => Promise<unknown>): Promise<number> {
  await run();
  let best = Infinity;
  for (let i = 0; i < 7; i++) {
    const t0 = performance.now();
    await run();
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}

describe("customer search with 5 000 customers", () => {
  it("answers in under 300 ms on phone, name, boat model, serial number and marina", async () => {
    await withRollback(async (tx) => {
      const tenantId = await bigFirm(tx);
      const search = (query: string) => searchCustomers(tx, tenantId, query, { now: NOW });

      // Each search and how many customers it finds, so it is clear that it finds something.
      const searches: [string, string, number][] = [
        ["phone, as typed", "070-000 42 42", 1],
        ["the end of a phone number", "0004242", 1],
        ["name", "Per Berg", 5000 / 8 / 5],
        ["name and number", "Anna Ek 04242", 0],
        ["boat name", "Båten 04242", 1],
        ["boat make and model", "Nimbus 3000", 1000],
        ["registration number", "SXK-04242", 1],
        ["engine model", "D3-220", 1667],
        ["engine serial number", "SN-0004242", 1],
        ["drive serial number", "DRV-0004242", 1],
        ["marina", "Marina 07", 250],
        ["marina and boat", "Marina 07 Nimbus", 0],
        ["something that is not there", "Zzzzzz", 0],
      ];
      const timings: string[] = [];
      const slow: string[] = [];
      for (const [what, query, expected] of searches) {
        const found = await search(query);
        // `expected` is how many exist; a page shows at most 50 of them.
        if (expected > 0) {
          expect(found.rows.length, what).toBe(Math.min(50, Math.ceil(expected)));
        }
        const ms = await fastest(() => search(query));
        timings.push(`${ms.toFixed(0).padStart(4)} ms  ${what} (${query})`);
        if (ms >= 300) slow.push(timings.at(-1)!);
      }
      console.info(
        `Search with ${String(CUSTOMERS)} customers, fastest of seven:\n${timings.join("\n")}`,
      );
      expect(slow).toEqual([]);

      // The list without a query is as quick.
      expect(await fastest(() => search(""))).toBeLessThan(300);
    });
  }, 120_000);

  it("can use the trigram index on the customers' text", async () => {
    await withRollback(async (tx) => {
      await bigFirm(tx);
      // With sequential scans off the planner must use an index if one fits: only the
      // trigram index fits `ILIKE '%text%'`.
      await tx.execute(sql`set local enable_seqscan = off`);
      const plan = (
        (await tx.execute(
          sql`explain select customer_id from customer_search
            where document ilike '%sn-0004242%' and document ilike '%nimbus%'`,
        )) as unknown as { "QUERY PLAN": string }[]
      )
        .map((r) => r["QUERY PLAN"])
        .join("\n");
      expect(plan).toContain("customer_search_document_trgm_idx");
    });
  }, 120_000);
});
