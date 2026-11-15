import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { nextSendAt } from "@bojen/core";
import { crm, sv } from "@bojen/core/i18n/sv";
import { CampaignError, campaignDetail, segmentCounts, springBoats } from "@bojen/db";
import { campaignOptOutKey, db, requireStaff } from "../../../../lib/server";
import { showDateTime, word } from "../../kunder/format";
import { AdminNav } from "../../nav";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: `${crm.campaigns.title} – ${sv.app.name}`,
  robots: "noindex",
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const t = crm.campaigns;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * One campaign (byggplan step 5.6): a draft shows who it would go to before it starts; a
 * started one shows sent, booked, declined and unanswered, the pre-booking rate against last
 * year, and every recipient with the time held for them.
 */
export default async function CampaignPage({ params, searchParams }: Props) {
  const { id } = await params;
  const staff = await requireStaff(`/kampanjer/${id}`);
  if (!UUID.test(id)) notFound();
  const tenantId = staff.context.tenantId;
  const now = new Date();
  const c = await campaignDetail(db(), tenantId, id, now).catch((error: unknown) => {
    if (error instanceof CampaignError) return null;
    throw error;
  });
  if (!c) notFound();
  const query = await searchParams;
  const done = first(query.klart);
  const problem = first(query.fel);
  const draft = c.status === "draft";
  const preview = draft
    ? segmentCounts(
        await springBoats({ db: db(), optOutKey: campaignOptOutKey() }, tenantId, c.rules),
      )
    : null;
  const firstRound = nextSendAt(c.scheduledAt && c.scheduledAt > now ? c.scheduledAt : now);

  return (
    <main className="booking crm campaigns-page">
      <AdminNav current="campaigns" />
      <p>
        <Link href="/kampanjer">{t.title}</Link>
      </p>
      <h1>{c.name}</h1>
      <p className="badge">{word(t.status, c.status)}</p>
      {done && t.doneMessage[done] ? <p role="status">{t.doneMessage[done]}</p> : null}
      {problem ? (
        <p className="error" role="alert">
          {t.errors[problem] ?? t.errors.failed}
        </p>
      ) : null}

      {preview ? (
        <section aria-labelledby="mottagare">
          <h2 id="mottagare">{t.segments}</h2>
          <ul>
            <li>
              {t.segmentA}: {preview.A}
            </li>
            <li>
              {t.segmentB}: {preview.B}
            </li>
          </ul>
          <p className="help">{t.segmentC}</p>
          {Object.keys(preview.excluded).length > 0 ? (
            <>
              <h3>{t.excludedTitle}</h3>
              <ul>
                {Object.entries(preview.excluded).map(([why, n]) => (
                  <li key={why}>
                    {word(t.excluded, why)}: {n}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <p className="help">{t.noInvoicesYet}</p>
          {staff.role !== "mechanic" ? (
            <form method="post" action={`/api/kampanjer/${id}/starta`}>
              <p className="help">{t.startHelp(showDateTime(firstRound))}</p>
              <button type="submit">{t.start}</button>
            </form>
          ) : null}
        </section>
      ) : (
        <>
          <section aria-labelledby="laget">
            <h2 id="laget">{t.numbers}</h2>
            <dl className="summary">
              <dt>{t.recipients}</dt>
              <dd>{c.recipients}</dd>
              <dt>{t.sent}</dt>
              <dd>{c.sent}</dd>
              <dt>{t.booked}</dt>
              <dd>{c.booked}</dd>
              <dt>{t.declined}</dt>
              <dd>{c.declined}</dd>
              <dt>{t.otherTime}</dt>
              <dd>{c.otherTime}</dd>
              <dt>{t.waiting}</dt>
              <dd>{c.waiting}</dd>
              <dt>{t.noReply}</dt>
              <dd>{c.noReply}</dd>
              <dt>{t.noSlot}</dt>
              <dd>{c.noSlot}</dd>
            </dl>
            {c.status === "scheduled" ? (
              <p className="help">{t.firstRound(showDateTime(firstRound))}</p>
            ) : null}
            <h3>{t.prebooked}</h3>
            <p>{t.prebookedCompare(c.prebooked.thisYear, c.prebooked.lastYear)}</p>
          </section>
          <section aria-labelledby="lista">
            <h2 id="lista">{t.recipients}</h2>
            <ul className="campaign-recipients">
              {c.recipientRows.map((r) => (
                <li key={r.id}>
                  <strong>{r.customerName}</strong> · {r.segment ?? "–"} ·{" "}
                  {word(t.recipientStatus, r.status)}
                  {r.answer ? ` (${word(t.answer, r.answer)})` : ""}
                  {r.problem ? ` – ${word(t.problem, r.problem)}` : ""}
                  {r.heldStart ? (
                    <span className="help">
                      {" "}
                      · {t.heldTime}: {showDateTime(r.heldStart)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
