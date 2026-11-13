import { describe, expect, it } from "vitest";
import {
  PIPELINE_COLUMNS,
  isPipelineStatus,
  mayMoveCard,
  statusAfterInvoice,
  statusAfterVisitDone,
} from "./pipeline";

describe("the pipeline", () => {
  it("has the spec's columns in order", () => {
    expect(PIPELINE_COLUMNS).toEqual([
      "inquiry",
      "quote",
      "parts_ordered",
      "booked",
      "done",
      "invoiced",
      "paid",
    ]);
  });

  it("knows its statuses", () => {
    for (const s of [...PIPELINE_COLUMNS, "cancelled"]) expect(isPipelineStatus(s)).toBe(true);
    for (const s of ["", "Booked", "deleted", null, 3]) expect(isPipelineStatus(s)).toBe(false);
  });

  it("lets owners and administrators move every card, a mechanic only their own", () => {
    expect(mayMoveCard("owner", false)).toBe(true);
    expect(mayMoveCard("admin", false)).toBe(true);
    expect(mayMoveCard("mechanic", true)).toBe(true);
    expect(mayMoveCard("mechanic", false)).toBe(false);
  });

  it("makes the job done when its last visit is done", () => {
    expect(statusAfterVisitDone("booked", 0)).toBe("done");
    expect(statusAfterVisitDone("parts_ordered", 0)).toBe("done");
    expect(statusAfterVisitDone("booked", 1)).toBeNull();
    for (const s of ["done", "invoiced", "paid", "cancelled"] as const) {
      expect(statusAfterVisitDone(s, 0)).toBeNull();
    }
  });

  it("makes the job invoiced when an invoice is made, unless it is paid", () => {
    expect(statusAfterInvoice("done")).toBe("invoiced");
    expect(statusAfterInvoice("booked")).toBe("invoiced");
    expect(statusAfterInvoice("invoiced")).toBeNull();
    expect(statusAfterInvoice("paid")).toBeNull();
  });
});
