/**
 * The pipeline (byggplan step 5.4, spec C4): every job is a card in one column, from the
 * inquiry to the paid invoice. Pure: who may move a card, and what follows on its own.
 */

/** The columns, left to right. `cancelled` is not a column: those cards leave the board. */
export const PIPELINE_COLUMNS = [
  "inquiry",
  "quote",
  "parts_ordered",
  "booked",
  "done",
  "invoiced",
  "paid",
] as const;

export type PipelineColumn = (typeof PIPELINE_COLUMNS)[number];
export type PipelineStatus = PipelineColumn | "cancelled";

export function isPipelineStatus(value: unknown): value is PipelineStatus {
  return (
    typeof value === "string" &&
    (value === "cancelled" || (PIPELINE_COLUMNS as readonly string[]).includes(value))
  );
}

/**
 * Owners and administrators move every card; a mechanic only the jobs where they have a
 * visit (spec 10.6: "läsa, redigera egna jobb").
 */
export function mayMoveCard(role: "owner" | "admin" | "mechanic", ownJob: boolean): boolean {
  return role === "owner" || role === "admin" || ownJob;
}

/**
 * When a visit is done, the job is done once none of its visits is left to do; a job that is
 * already invoiced or paid stays where it is.
 */
export function statusAfterVisitDone(
  current: PipelineStatus,
  visitsLeft: number,
): PipelineStatus | null {
  if (visitsLeft > 0) return null;
  if (
    current === "done" ||
    current === "invoiced" ||
    current === "paid" ||
    current === "cancelled"
  ) {
    return null;
  }
  return "done";
}

/** An invoice for the job moves its card to invoiced, unless it is paid already. */
export function statusAfterInvoice(current: PipelineStatus): PipelineStatus | null {
  return current === "invoiced" || current === "paid" ? null : "invoiced";
}
