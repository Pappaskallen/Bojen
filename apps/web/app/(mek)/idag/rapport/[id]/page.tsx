import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RECOMMENDATION_PRIORITIES, formatKronor, stockholmDate } from "@bojen/core";
import { crm, sv } from "@bojen/core/i18n/sv";
import { ReportError, reportView } from "@bojen/db";
import { db, requireStaff } from "../../../../../lib/server";
import { showDateTime, word } from "../../../../(admin)/kunder/format";
import { AdminNav } from "../../../../(admin)/nav";
import { BoatPicture } from "../../boat-picture";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: `${crm.report.title} – ${sv.app.name}`,
  robots: "noindex",
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const t = crm.report;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
/** Empty rows under the report's recommendations, for new ones. */
const EMPTY_ROWS = 2;
const hours = (h: number | null) =>
  h === null ? "–" : `${h.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} h`;
const kronor = (ore: number) => (ore / 100).toLocaleString("sv-SE", { maximumFractionDigits: 2 });

/**
 * The service report of a done visit (byggplan step 5.5d): the draft from Claude, what it is
 * built on, and the invoice basis. The mechanic changes it and approves it, which sends it to
 * the customer (F7). Plain forms; it needs coverage, as the draft is written on the server.
 */
export default async function ReportPage({ params, searchParams }: Props) {
  const { id } = await params;
  const staff = await requireStaff(`/idag/rapport/${id}`);
  if (!UUID.test(id)) notFound();
  const actor = {
    tenantId: staff.context.tenantId,
    userId: staff.context.actor.id,
    role: staff.role,
  };
  const report = await reportView(db(), actor, id).catch((error: unknown) => {
    if (error instanceof ReportError) return null;
    throw error;
  });
  if (!report) notFound();
  const query = await searchParams;
  const done = first(query.klart);
  const problem = first(query.fel);
  const open = report.status !== "approved";
  const action = `/api/idag/${id}/rapport`;
  const rows = [
    ...report.recommendations,
    ...Array.from({ length: open ? EMPTY_ROWS : 0 }, () => ({ text: "", priority: "monitor" })),
  ];

  return (
    <main className="booking crm day-page report-page">
      <AdminNav current="today" />
      <p>
        <Link href={`/idag?dag=${stockholmDate(report.start)}#besok-${id}`}>{t.back}</Link>
      </p>
      {report.boatPicture ? (
        <BoatPicture
          visitId={id}
          boatId={report.boat?.id ?? null}
          label={report.boat?.label ?? report.customer}
        />
      ) : null}
      <h1>{t.title}</h1>
      <p className="meta">
        {[report.customer, report.boat?.label, report.service, showDateTime(report.start)]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {done && t.doneMessage[done] ? <p role="status">{t.doneMessage[done]}</p> : null}
      {problem ? (
        <p className="error" role="alert">
          {t.errors[problem] ?? t.errors.failed}
        </p>
      ) : null}
      {report.status === "drafting" ? <p className="help">{t.drafting}</p> : null}
      {report.status === "draft" && report.draftedBy && report.draftedBy !== "mechanic" ? (
        <p className="help">{t.aiDraft}</p>
      ) : null}
      {report.approvedAt ? (
        <p className="badge">{t.approvedAt(showDateTime(report.approvedAt))}</p>
      ) : null}

      <section aria-labelledby="underlag">
        <h2 id="underlag">{t.facts}</h2>
        {report.facts.engines.length > 0 ? (
          <>
            <h3>{t.hours}</h3>
            <ul>
              {report.facts.engines.map((e) => (
                <li key={e.label}>
                  {e.label}: {hours(e.hours)} ({t.previous(hours(e.previousHours))})
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {report.facts.notes ? <p className="pre">{report.facts.notes}</p> : null}
        {report.facts.voiceNotes.length > 0 || report.untranscribed > 0 ? (
          <>
            <h3>{t.voiceNotes}</h3>
            <ul>
              {report.facts.voiceNotes.map((v, i) => (
                <li key={i}>{v}</li>
              ))}
              {Array.from({ length: report.untranscribed }, (_, i) => (
                <li key={`w${String(i)}`} className="help">
                  {t.notTranscribed}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <p className="help">{crm.day.photoCount(report.facts.photos)}</p>
      </section>

      <form method="post" action={action}>
        <section aria-labelledby="arbete">
          <h2 id="arbete">{t.workDone}</h2>
          <label className="field">
            <span>{t.workDoneHelp}</span>
            <textarea
              name="workDone"
              rows={8}
              maxLength={6000}
              defaultValue={report.workDone}
              readOnly={!open}
            />
          </label>
        </section>

        <section aria-labelledby="rek">
          <h2 id="rek">{t.recommendations}</h2>
          {rows.map((r, i) => (
            <div className="rec-row" key={i}>
              <label className="field">
                <span>
                  {t.recommendation} {i + 1}
                </span>
                <input
                  name={`rec-text-${String(i)}`}
                  defaultValue={r.text}
                  maxLength={300}
                  readOnly={!open}
                />
              </label>
              <label className="field">
                <span>{t.priorityLabel}</span>
                <select
                  name={`rec-priority-${String(i)}`}
                  defaultValue={r.priority}
                  disabled={!open}
                >
                  {RECOMMENDATION_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {word(t.priority, p)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ))}
        </section>

        <section aria-labelledby="nasta">
          <h2 id="nasta">{t.nextService}</h2>
          <label className="field">
            <span>{t.nextService}</span>
            <input
              name="nextService"
              defaultValue={report.nextService ?? ""}
              maxLength={300}
              readOnly={!open}
            />
          </label>
        </section>

        {open ? (
          <div className="actions">
            <button type="submit" name="do" value="spara" className="secondary">
              {t.save}
            </button>
          </div>
        ) : null}

        <section aria-labelledby="faktura">
          <h2 id="faktura">{t.invoice}</h2>
          <InvoiceTable report={report} open={open} />
          {open ? (
            <fieldset className="add-line">
              <legend>{t.addLine}</legend>
              <label className="field">
                <span>{t.type}</span>
                <select name="lineType" defaultValue="labour">
                  {(["labour", "callout", "emergency", "discount"] as const).map((type) => (
                    <option key={type} value={type}>
                      {word(t.lineType, type)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t.description}</span>
                <input name="description" maxLength={200} autoComplete="off" />
              </label>
              <label className="field">
                <span>{t.quantity}</span>
                <input name="quantity" inputMode="decimal" defaultValue="1" />
              </label>
              <label className="field">
                <span>{t.unitPrice}</span>
                <input
                  name="unitPrice"
                  inputMode="decimal"
                  defaultValue={report.hourlyRateOre ? kronor(report.hourlyRateOre) : ""}
                />
              </label>
              <button type="submit" name="do" value="rad" className="secondary">
                {t.addLine}
              </button>
            </fieldset>
          ) : null}
        </section>

        {open ? (
          <section aria-label={t.approve}>
            <p className="help">{t.approveHelp}</p>
            <button type="submit" name="do" value="godkann" className="approve">
              {t.approve}
            </button>
          </section>
        ) : null}
      </form>
    </main>
  );
}

/**
 * The lines with their sums, inside the report form: every button there also keeps what the
 * mechanic has written (see the report route), so adding or removing a line loses nothing.
 */
function InvoiceTable({
  report,
  open,
}: {
  report: Awaited<ReturnType<typeof reportView>>;
  open: boolean;
}) {
  if (report.lines.length === 0) return <p className="help">{t.noLines}</p>;
  return (
    <>
      <div className="table-scroll">
        <table className="invoice-lines">
          <thead>
            <tr>
              <th>{t.description}</th>
              <th className="amount">{t.quantity}</th>
              <th className="amount">{t.amount}</th>
              {open ? <th aria-label={t.remove} /> : null}
            </tr>
          </thead>
          <tbody>
            {report.lines.map((l, i) => (
              <tr key={l.id ?? `p${String(i)}`}>
                <td>
                  {l.description}
                  <br />
                  <span className="help">{word(t.lineType, l.type)}</span>
                  {l.noPrice ? (
                    <>
                      <br />
                      <span className="error">{t.noPrice}</span>
                    </>
                  ) : null}
                </td>
                <td className="amount">{l.quantity.toLocaleString("sv-SE")}</td>
                <td className="amount">{l.noPrice ? "–" : formatKronor(l.amountOre)}</td>
                {open ? (
                  <td>
                    {l.id ? (
                      <button
                        type="submit"
                        name="do"
                        value={`bort:${l.id}`}
                        className="secondary"
                        aria-label={`${t.remove}: ${l.description}`}
                      >
                        {t.remove}
                      </button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>{t.net}</td>
              <td className="amount">{formatKronor(report.netOre)}</td>
            </tr>
            <tr>
              <td colSpan={2}>{t.vat}</td>
              <td className="amount">{formatKronor(report.vatOre)}</td>
            </tr>
            <tr>
              <td colSpan={2}>{t.gross}</td>
              <td className="amount">{formatKronor(report.grossOre)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {report.lines.some((l) => l.type === "part") ? <p className="help">{t.partsHelp}</p> : null}
    </>
  );
}
