import type { Metadata } from "next";
import { PIPELINE_COLUMNS, mayMoveCard, stockholmDate } from "@bojen/core";
import { crm, sv } from "@bojen/core/i18n/sv";
import { SETTLED_LIMIT, pipelineBoard } from "@bojen/db";
import { db, requireStaff } from "../../../lib/server";
import { AdminNav } from "../nav";
import { SignOutButton } from "../sign-out";
import { Board, type BoardCard } from "./board";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: `${crm.pipeline.title} – ${sv.app.name}`,
  robots: "noindex",
};

/**
 * The pipeline (byggplan step 5.4, spec C4): every job as a card, from inquiry to paid. All
 * staff see the board; owners and administrators move every card, a mechanic their own.
 */
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function PipelinePage({ searchParams }: Props) {
  const staff = await requireStaff("/pipeline");
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const marked = one(params.fakturerat);
  const month = one(params.manad) ?? stockholmDate(new Date()).slice(0, 7);
  const t = crm.invoiceExport;
  const board = await pipelineBoard(db(), staff.context.tenantId);
  const me = staff.context.actor.id;
  const cards: BoardCard[] = PIPELINE_COLUMNS.flatMap((column) =>
    board[column].map((c) => ({
      jobId: c.jobId,
      status: column,
      customerId: c.customerId,
      customer: c.customer,
      boatId: c.boatId,
      boat: c.boat,
      service: c.service,
      visitStart: c.visitStart?.toISOString() ?? null,
      canMove: mayMoveCard(staff.role, c.mechanicIds.includes(me)),
    })),
  );
  return (
    <main className="booking crm pipeline-page">
      <AdminNav current="pipeline" />
      <h1>{crm.pipeline.title}</h1>
      <p className="help">{crm.pipeline.intro}</p>
      <SignOutButton />
      <Board cards={cards} settledLimit={SETTLED_LIMIT} />
      {staff.role !== "mechanic" && (
        <section className="invoice-export" aria-labelledby="invoice-export-heading">
          <h2 id="invoice-export-heading">{t.heading}</h2>
          <p className="help">{t.intro}</p>
          {marked !== undefined && /^d+$/.test(marked) && (
            <p role="status">{t.marked(Number(marked))}</p>
          )}
          {params.fakturafel !== undefined && <p role="alert">{t.invalidMonth}</p>}
          <form method="get" action="/api/fakturaunderlag">
            <label htmlFor="invoice-month">{t.month}</label>
            <input id="invoice-month" name="manad" type="month" defaultValue={month} required />
            <button type="submit">{t.download}</button>
            <button type="submit" formMethod="post" formAction="/api/fakturaunderlag/fakturerat">
              {t.markInvoiced}
            </button>
          </form>
        </section>
      )}
    </main>
  );
}
