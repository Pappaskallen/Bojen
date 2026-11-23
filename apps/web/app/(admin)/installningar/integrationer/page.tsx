import type { Metadata } from "next";
import { fortnoxSettings } from "@bojen/core/fortnox";
import { crm, sv } from "@bojen/core/i18n/sv";
import { fortnoxStatus, tenant } from "@bojen/db";
import { eq } from "drizzle-orm";
import { db, fortnoxApi, requireStaff } from "../../../../lib/server";
import { AdminNav } from "../../nav";
import { SignOutButton } from "../../sign-out";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: `${crm.integrations.title} – ${sv.app.name}`,
  robots: "noindex",
};

const LINE_TYPES = ["labour", "callout", "emergency", "discount", "part"] as const;
const DATE = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", dateStyle: "long" });

type Props = { searchParams: Promise<{ fortnox?: string }> };

/** Connecting Fortnox and the firm's article numbers (byggplan step 8). */
export default async function IntegrationsPage({ searchParams }: Props) {
  const staff = await requireStaff("/installningar/integrationer");
  const { fortnox: result } = await searchParams;
  const t = crm.integrations;
  const tenantId = staff.context.tenantId;
  const status = await fortnoxStatus(db(), tenantId);
  const [firm] = await db()
    .select({ settings: tenant.settings })
    .from(tenant)
    .where(eq(tenant.id, tenantId));
  const settings = fortnoxSettings(firm?.settings);
  const canChange = staff.role !== "mechanic";
  const registered = fortnoxApi() !== null;
  const message = result ? t.results[result] : undefined;
  const failed = result !== undefined && !["kopplad", "bortkopplad", "sparad"].includes(result);

  return (
    <main className="booking crm">
      <AdminNav current="integrations" />
      <h1>{t.title}</h1>
      <p className="help">{t.intro}</p>
      <SignOutButton />
      {message ? (
        <p role={failed ? "alert" : "status"} className={failed ? "error" : undefined}>
          {message}
        </p>
      ) : null}

      <section aria-labelledby="fortnox-status">
        <h2 id="fortnox-status" className="visually-hidden">
          {t.title}
        </h2>
        {!registered ? (
          <p>{t.notRegistered}</p>
        ) : status ? (
          <p>
            {status.needsReconnect
              ? t.needsReconnect
              : t.connected(status.companyName, DATE.format(status.connectedAt))}
          </p>
        ) : (
          <p>{t.notConnected}</p>
        )}
        {canChange && registered ? (
          <div className="actions">
            {!status || status.needsReconnect ? (
              <a className="button" href="/api/integrationer/fortnox/koppla">
                {status ? t.reconnect : t.connect}
              </a>
            ) : null}
            {status ? (
              <form method="post" action="/api/integrationer/fortnox/koppla-fran">
                <button type="submit">{t.disconnect}</button>
                <p className="help">{t.disconnectNote}</p>
              </form>
            ) : null}
          </div>
        ) : null}
        {!canChange ? <p className="help">{t.onlyOwners}</p> : null}
      </section>

      {canChange ? (
        <section aria-labelledby="fortnox-articles">
          <h2 id="fortnox-articles">{t.articlesHeading}</h2>
          <p className="help">{t.articlesIntro}</p>
          <form method="post" action="/api/integrationer/fortnox/installningar">
            {LINE_TYPES.map((type) => (
              <p key={type}>
                <label htmlFor={`artikel_${type}`}>
                  {t.article(crm.report.lineType[type] ?? type)}
                </label>
                <input
                  id={`artikel_${type}`}
                  name={`artikel_${type}`}
                  defaultValue={settings.articles[type] ?? ""}
                  maxLength={50}
                  autoComplete="off"
                />
              </p>
            ))}
            <p>
              <label htmlFor="forfallodagar">{t.dueDays}</label>
              <input
                id="forfallodagar"
                name="forfallodagar"
                type="number"
                min={0}
                max={90}
                defaultValue={settings.dueDays}
                required
              />
            </p>
            <button type="submit">{t.save}</button>
          </form>
        </section>
      ) : null}
    </main>
  );
}
