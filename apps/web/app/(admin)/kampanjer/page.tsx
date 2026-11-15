import type { Metadata } from "next";
import Link from "next/link";
import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_TARGET_WEEK,
  looksLikeLayUp,
  looksLikeSpringService,
  stockholmDate,
} from "@bojen/core";
import { crm, sv } from "@bojen/core/i18n/sv";
import { campaignList, serviceType } from "@bojen/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db, requireStaff } from "../../../lib/server";
import { showDateTime, word } from "../kunder/format";
import { AdminNav } from "../nav";
import { SignOutButton } from "../sign-out";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: `${crm.campaigns.title} – ${sv.app.name}`,
  robots: "noindex",
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const t = crm.campaigns;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * The campaigns (byggplan step 5.6, flow F11): the firm's campaigns with how far each has
 * come, and a new spring campaign. Owners and administrators create and start them.
 */
export default async function CampaignsPage({ searchParams }: Props) {
  const staff = await requireStaff("/kampanjer");
  const query = await searchParams;
  const problem = first(query.fel);
  const tenantId = staff.context.tenantId;
  const campaigns = await campaignList(db(), tenantId);
  const services = await db()
    .select({ id: serviceType.id, name: serviceType.name })
    .from(serviceType)
    .where(and(eq(serviceType.tenantId, tenantId), isNull(serviceType.deletedAt)))
    .orderBy(asc(serviceType.name));
  const today = stockholmDate(new Date());
  // From July the next spring is next year's.
  const year = Number(today.slice(0, 4)) + (Number(today.slice(5, 7)) >= 7 ? 1 : 0);
  const january10 = `${String(year)}-01-10`;
  const startDate = january10 > today ? january10 : today;
  const mayCreate = staff.role !== "mechanic";
  const springDefault = services.find((s) => looksLikeSpringService(s.name))?.id;

  return (
    <main className="booking crm campaigns-page">
      <AdminNav current="campaigns" />
      <h1>{t.title}</h1>
      {problem ? (
        <p className="error" role="alert">
          {t.errors[problem] ?? t.errors.failed}
        </p>
      ) : null}

      {campaigns.length === 0 ? (
        <p>{t.none}</p>
      ) : (
        <ul className="campaign-list">
          {campaigns.map((c) => (
            <li key={c.id}>
              <Link href={`/kampanjer/${c.id}`}>{c.name}</Link>{" "}
              <span className="badge">{word(t.status, c.status)}</span>
              <p className="help">
                {c.scheduledAt ? `${t.startDate}: ${showDateTime(c.scheduledAt)} · ` : ""}
                {t.recipients} {c.recipients} · {t.sent} {c.sent} · {t.booked} {c.booked}
              </p>
            </li>
          ))}
        </ul>
      )}

      {mayCreate ? (
        <section aria-labelledby="ny">
          <h2 id="ny">{t.newTitle}</h2>
          <p className="help">{t.intro}</p>
          <form method="post" action="/api/kampanjer" className="campaign-form">
            <label className="field">
              <span>{t.name}</span>
              <input name="name" required maxLength={120} defaultValue={t.defaultName(year)} />
            </label>
            <label className="field">
              <span>{t.year}</span>
              <input name="year" inputMode="numeric" required defaultValue={String(year)} />
            </label>
            <label className="field">
              <span>{t.startDate}</span>
              <input name="startDate" type="date" required defaultValue={startDate} />
            </label>
            <fieldset>
              <legend>{t.springServices}</legend>
              {services.map((s) => (
                <label key={s.id} className="check">
                  <input
                    type="checkbox"
                    name="spring"
                    value={s.id}
                    defaultChecked={looksLikeSpringService(s.name)}
                  />{" "}
                  {s.name}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>{t.layUpServices}</legend>
              {services.map((s) => (
                <label key={s.id} className="check">
                  <input
                    type="checkbox"
                    name="layUp"
                    value={s.id}
                    defaultChecked={looksLikeLayUp(s.name)}
                  />{" "}
                  {s.name}
                </label>
              ))}
            </fieldset>
            <label className="field">
              <span>{t.bookService}</span>
              <select name="bookService" required defaultValue={springDefault}>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t.batchSize}</span>
              <input
                name="batchSize"
                inputMode="numeric"
                defaultValue={String(DEFAULT_BATCH_SIZE)}
              />
            </label>
            <label className="field">
              <span>{t.defaultWeek}</span>
              <input
                name="defaultWeek"
                inputMode="numeric"
                defaultValue={String(DEFAULT_TARGET_WEEK)}
              />
            </label>
            <label className="field">
              <span>{t.discount}</span>
              <input name="discount" inputMode="decimal" />
            </label>
            <button type="submit">{t.create}</button>
          </form>
        </section>
      ) : null}
      <SignOutButton />
    </main>
  );
}
