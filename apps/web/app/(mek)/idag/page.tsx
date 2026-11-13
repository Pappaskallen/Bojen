import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { addDays, formatPhone } from "@bojen/core";
import { crm, sv } from "@bojen/core/i18n/sv";
import { dayOf, dayRoute, dayVisits } from "@bojen/db";
import { db, maps, requireStaff } from "../../../lib/server";
import { word } from "../../(admin)/kunder/format";
import { AdminNav } from "../../(admin)/nav";
import { SignOutButton } from "../../(admin)/sign-out";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: `${crm.day.title} – ${sv.app.name}`,
  robots: "noindex",
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const t = crm.day;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const START_FROM = ["tentative", "booked", "confirmed", "unconfirmed"];

/**
 * The mechanic's day (byggplan step 5.5, part a): the day's visits in the suggested driving
 * order, with start and done, running hours, parts and pictures. Plain forms, so it works
 * without JavaScript; the offline queue comes in part b.
 */
export default async function TodayPage({ searchParams }: Props) {
  const staff = await requireStaff("/idag");
  const query = await searchParams;
  const now = new Date();
  const day = dayOf(first(query.dag), now);
  const tenantId = staff.context.tenantId;
  const visits = await dayVisits(db(), tenantId, staff.context.actor.id, day);
  const route = await dayRoute({ db: db(), maps: maps() }, tenantId, visits, now).catch(() => null);
  const ordered = route ? route.order.flatMap((id) => visits.filter((v) => v.id === id)) : visits;
  const done = first(query.klart);
  const problem = first(query.fel);
  const savedMinutes = route ? Math.round((route.bookedSeconds - route.suggestedSeconds) / 60) : 0;
  const action = (visitId: string, name: string) => `/api/idag/${visitId}/${name}`;

  return (
    <main className="booking crm day-page">
      <AdminNav current="today" />
      <h1>{t.title}</h1>
      <nav className="day-pager" aria-label={t.other(day)}>
        <Link href={`/idag?dag=${addDays(day, -1)}`}>{t.previous}</Link>
        <span>{t.other(day)}</span>
        <Link href={`/idag?dag=${addDays(day, 1)}`}>{t.next}</Link>
      </nav>
      {done && t.doneMessage[done] ? <p role="status">{t.doneMessage[done]}</p> : null}
      {problem ? (
        <p className="error" role="alert">
          {t.errors[problem] ?? t.errors.failed}
        </p>
      ) : null}

      {visits.length === 0 ? (
        <p>{t.none}</p>
      ) : (
        <>
          <section aria-labelledby="route">
            <h2 id="route">{t.route}</h2>
            <p className="help">
              {!route || !route.exhaustive
                ? t.manyStops
                : savedMinutes > 0
                  ? t.saves(savedMinutes)
                  : t.asBooked}
            </p>
          </section>
          <ol className="day-list">
            {ordered.map((v) => (
              <li
                key={v.id}
                id={`besok-${v.id}`}
                className="day-visit"
                aria-label={v.customer.name}
              >
                <header>
                  <span className="when">{v.promised}</span>
                  <span className="badge">{word(crm.visitStatus, v.status)}</span>
                </header>
                <h2>
                  <Link href={`/kunder/${v.customer.id}`}>{v.customer.name}</Link>
                </h2>
                <p className="meta">
                  {[
                    v.boat?.label,
                    v.place
                      ? `${v.place.name}${v.place.spotId ? ` ${v.place.spotId}` : ""}, ${word(crm.placementMode, v.place.mode)}`
                      : null,
                    v.service,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {v.description ? <p className="pre">{v.description}</p> : null}
                <div className="actions">
                  {v.customer.phone ? (
                    <a className="button secondary" href={`tel:${v.customer.phone}`}>
                      {t.call} {formatPhone(v.customer.phone)}
                    </a>
                  ) : null}
                  {v.boat ? <Link href={`/batar/${v.boat.id}`}>{crm.boat.title}</Link> : null}
                </div>
                {START_FROM.includes(v.status) ? (
                  <form method="post" action={action(v.id, "starta")} className="actions">
                    <input type="hidden" name="key" value={randomUUID()} />
                    <button type="submit">{t.start}</button>
                  </form>
                ) : null}
                {v.status === "in_progress" ? (
                  <form method="post" action={action(v.id, "klart")} className="actions">
                    <input type="hidden" name="key" value={randomUUID()} />
                    <button type="submit">{t.done}</button>
                  </form>
                ) : null}

                {v.engines.length > 0 ? (
                  <details>
                    <summary>{t.hours}</summary>
                    {v.engines.map((e) => (
                      <form
                        key={e.id}
                        method="post"
                        action={action(v.id, "timmar")}
                        className="inline"
                      >
                        <input type="hidden" name="engineId" value={e.id} />
                        <label className="field">
                          <span>
                            {e.label}
                            {e.lastHours !== null ? ` (${t.lastHours(e.lastHours)})` : ""}
                          </span>
                          <input name="hours" inputMode="decimal" required autoComplete="off" />
                        </label>
                        <button type="submit">{t.save}</button>
                      </form>
                    ))}
                  </details>
                ) : null}

                <details>
                  <summary>
                    {t.parts} ({v.parts.length})
                  </summary>
                  {v.parts.length === 0 ? <p className="help">{t.noParts}</p> : null}
                  {v.parts.map((p) => (
                    <form
                      key={p.id}
                      method="post"
                      action={action(v.id, "delstatus")}
                      className="inline"
                    >
                      <input type="hidden" name="jobPartId" value={p.id} />
                      <label className="field">
                        <span>
                          {p.quantity} × {p.description} ({p.articleNumber})
                        </span>
                        <select name="status" defaultValue={p.status}>
                          {Object.entries(t.partStatus).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button type="submit" className="secondary">
                        {t.save}
                      </button>
                    </form>
                  ))}
                  <form method="post" action={action(v.id, "del")}>
                    <label className="field">
                      <span>{t.articleNumber}</span>
                      <input name="articleNumber" required maxLength={60} autoComplete="off" />
                    </label>
                    <label className="field">
                      <span>{t.partDescription}</span>
                      <input name="description" maxLength={200} autoComplete="off" />
                    </label>
                    <label className="field">
                      <span>{t.quantity}</span>
                      <input name="quantity" inputMode="decimal" defaultValue="1" />
                    </label>
                    <button type="submit">{t.addPart}</button>
                  </form>
                </details>

                <details>
                  <summary>
                    {t.photos} ({t.photoCount(v.photos)})
                  </summary>
                  <form method="post" action={action(v.id, "bild")} encType="multipart/form-data">
                    <label className="field">
                      <span>{t.addPhoto}</span>
                      <input
                        name="photo"
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/heic"
                        capture="environment"
                        required
                      />
                    </label>
                    <button type="submit">{t.upload}</button>
                  </form>
                </details>
              </li>
            ))}
          </ol>
        </>
      )}
      <SignOutButton />
    </main>
  );
}
