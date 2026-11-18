import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatPhone } from "@bojen/core";
import { crm, sv } from "@bojen/core/i18n/sv";
import { boatCard, nameplateSuggestions } from "@bojen/db";
import { db, requireStaff, storage } from "../../../../lib/server";
import { showDate, showDateTime, word } from "../../kunder/format";
import { AdminNav } from "../../nav";
import { SignOutButton } from "../../sign-out";
import { AccessReveal } from "./access-reveal";
import { HoursChart } from "./hours-chart";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: `${crm.boat.title} – ${sv.app.name}`,
  robots: "noindex",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const t = crm.boat;
const none = crm.card.unknown;
/** Signed picture links last long enough to look at the page, no longer. */
const PICTURE_SECONDS = 600;

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const isoDay = (iso: string | null) => (iso ? showDate(new Date(`${iso}T12:00:00Z`)) : null);

/**
 * The boat card (byggplan step 5.2, spec C1): everything about one boat on one page. All
 * signed-in staff may read it; the codes are not on the page, only behind the button, which
 * follows the access rule and logs every view.
 */
export default async function BoatCardPage({ params, searchParams }: Props) {
  const { id } = await params;
  const staff = await requireStaff(`/batar/${id}`);
  if (!UUID.test(id)) notFound();
  const card = await boatCard(db(), staff.context.tenantId, id, new Date());
  if (!card) notFound();

  const query = await searchParams;
  const plateDone = first(query.typskylt);
  const plateProblem = first(query.typskyltfel);
  const suggestions = await Promise.all(
    (await nameplateSuggestions(db(), staff.context.tenantId, id)).map(async (s) => {
      const picture = card.pictures.find((p) => p.id === s.attachmentId);
      const url = picture
        ? await storage()
            .signedUrl(picture.storageKey, PICTURE_SECONDS)
            .catch(() => null)
        : null;
      return { ...s, url };
    }),
  );

  const pictures = (
    await Promise.all(
      card.pictures.map(async (p) => {
        try {
          return { ...p, url: await storage().signedUrl(p.storageKey, PICTURE_SECONDS) };
        } catch {
          return null;
        }
      }),
    )
  ).filter((p): p is NonNullable<typeof p> => p !== null);

  const engineName = (e: (typeof card.engines)[number], i: number) =>
    [
      word(crm.enginePosition, e.position) || null,
      [e.make, e.model].filter(Boolean).join(" ") || `${t.engine} ${String(i + 1)}`,
    ]
      .filter(Boolean)
      .join(": ");

  return (
    <main className="booking crm">
      <AdminNav current="customers" />
      <h1>{card.name ?? ([card.make, card.model].filter(Boolean).join(" ") || t.unnamed)}</h1>
      <SignOutButton />

      <section aria-labelledby="about">
        <h2 id="about">{t.about}</h2>
        <dl className="summary">
          <dt>{t.make}</dt>
          <dd>{[card.make, card.model].filter(Boolean).join(" ") || none}</dd>
          <dt>{t.length}</dt>
          <dd>{card.lengthM ? crm.card.length(card.lengthM) : none}</dd>
          <dt>{t.year}</dt>
          <dd>{card.year ?? none}</dd>
          <dt>{t.hull}</dt>
          <dd>{card.hullType ?? none}</dd>
          <dt>{t.registration}</dt>
          <dd>{card.registrationNumber ?? none}</dd>
          <dt>{t.status}</dt>
          <dd>{word(crm.boatStatus, card.status)}</dd>
        </dl>
      </section>

      <section aria-labelledby="owners">
        <h2 id="owners">{t.owners}</h2>
        {card.owners.length === 0 ? (
          <p>{t.noOwners}</p>
        ) : (
          <ul className="boat-list">
            {card.owners.map((o) => (
              <li key={o.customerId}>
                <strong>
                  <Link href={`/kunder/${o.customerId}`}>{o.name}</Link>
                </strong>
                <span className="badge">{word(crm.ownershipRole, o.role)}</span>
                <span className="meta">{o.phone ? formatPhone(o.phone) : none}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="placements">
        <h2 id="placements">{t.placements}</h2>
        {card.placements.length === 0 ? (
          <p>{t.noPlacements}</p>
        ) : (
          <ul className="boat-list">
            {card.placements.map((p) => (
              <li key={p.id}>
                <strong>{word(crm.season, p.season)}</strong>
                {p.current ? <span className="badge">{t.here}</span> : null}
                <span>
                  <Link href={`/marinor/${p.locationId}`}>{p.place}</Link>
                  {[p.spotId ? t.spot(p.spotId) : null, word(crm.placementMode, p.mode)]
                    .filter(Boolean)
                    .map((part) => `, ${part}`)
                    .join("")}
                </span>
                <span className="meta">
                  {[
                    isoDay(p.launchDate) ? `${t.launch} ${isoDay(p.launchDate) ?? ""}` : null,
                    isoDay(p.haulOutDate) ? `${t.haulOut} ${isoDay(p.haulOutDate) ?? ""}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="engines" id="motorer">
        <h2 id="engines">{t.engines}</h2>
        {plateDone && t.nameplateDone[plateDone] ? (
          <p role="status">{t.nameplateDone[plateDone]}</p>
        ) : null}
        {plateProblem ? (
          <p className="error" role="alert">
            {t.nameplateErrors[plateProblem] ?? t.nameplateErrors.failed}
          </p>
        ) : null}
        {suggestions.length > 0 ? (
          <div className="nameplates" role="group" aria-label={t.nameplate}>
            <h3>{t.nameplate}</h3>
            <p className="help">{t.nameplateIntro}</p>
            {suggestions.map((s) => (
              <form key={s.id} method="post" action={`/api/batar/${id}/typskylt/${s.id}`}>
                <p>
                  <strong>{[s.make, s.model].filter(Boolean).join(" ") || none}</strong>
                  {s.serialNumber ? ` · ${t.serial} ${s.serialNumber}` : ""}
                  <br />
                  <span className="help">{t.nameplateRead(s.make ?? none, s.confidence)}</span>
                  {s.url ? (
                    <>
                      {" "}
                      <a href={s.url} target="_blank" rel="noreferrer">
                        {t.nameplatePicture}
                      </a>
                    </>
                  ) : null}
                </p>
                <label className="field">
                  <span>{t.nameplateEngine}</span>
                  <select name="engineId" defaultValue={card.engines[0]?.id ?? "ny"}>
                    {card.engines.map((e, i) => (
                      <option key={e.id} value={e.id}>
                        {engineName(e, i)}
                      </option>
                    ))}
                    <option value="ny">{t.nameplateNewEngine}</option>
                  </select>
                </label>
                <div className="actions">
                  <button type="submit" name="do" value="confirm">
                    {t.nameplateUse}
                  </button>
                  <button type="submit" name="do" value="dismiss" className="secondary">
                    {t.nameplateDismiss}
                  </button>
                </div>
              </form>
            ))}
          </div>
        ) : null}
        {card.engines.length === 0 ? (
          <p>{t.noEngines}</p>
        ) : (
          <ul className="boat-list">
            {card.engines.map((e, i) => (
              <li key={e.id}>
                <strong>{engineName(e, i)}</strong>
                <span className="meta">
                  {[
                    e.modelYear ? t.modelYear(e.modelYear) : null,
                    e.type ? word(crm.engineType, e.type) : null,
                    e.fuel ? word(crm.engineFuel, e.fuel) : null,
                    e.serialNumber ? `${t.serial} ${e.serialNumber}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {e.drive ? (
                  <span className="meta">
                    {[
                      `${t.drive}: ${e.drive.type ?? none}`,
                      e.drive.serialNumber ? `${t.serial} ${e.drive.serialNumber}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="hours">
        <h2 id="hours">{t.hours}</h2>
        <HoursChart
          series={card.engines.map((e, i) => ({ label: engineName(e, i), points: e.hours }))}
        />
      </section>

      <section aria-labelledby="recommendations">
        <h2 id="recommendations">{t.recommendations}</h2>
        {card.recommendations ? (
          <>
            <p className="pre">{card.recommendations.text}</p>
            {card.recommendations.nextService ? (
              <p>{t.nextService(card.recommendations.nextService)}</p>
            ) : null}
            <p className="help">{t.fromReport(showDate(card.recommendations.from))}</p>
          </>
        ) : (
          <p>{t.noRecommendations}</p>
        )}
      </section>

      <section aria-labelledby="history">
        <h2 id="history">{t.history}</h2>
        {card.history.length === 0 ? (
          <p>{t.noHistory}</p>
        ) : (
          <ul className="visit-list">
            {card.history.map((v) => (
              <li key={v.id}>
                <span className="when">{showDateTime(v.start)}</span>
                <span className="status" data-status={v.status}>
                  {word(crm.visitStatus, v.status)}
                </span>
                <span>
                  {[v.service, v.mechanic].filter(Boolean).join(" · ") || none}
                  {v.report?.workDone ? (
                    <span className="report pre">
                      {t.report}: {v.report.workDone}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="pictures">
        <h2 id="pictures">{t.pictures}</h2>
        {pictures.length === 0 ? (
          <p>{t.noPictures}</p>
        ) : (
          <ul className="pictures">
            {pictures.map((p, i) => (
              <li key={p.id}>
                <a href={p.url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- signed links to a private bucket */}
                  <img
                    src={p.url}
                    alt={`${t.picture(i + 1)}, ${showDate(p.createdAt)}`}
                    loading="lazy"
                  />
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="access">
        <h2 id="access">{t.access}</h2>
        <p className="help">{t.accessIntro}</p>
        <dl className="summary">
          <dt>{t.code}</dt>
          <dd>{card.access.code ? t.stored : t.missing}</dd>
          <dt>{t.keyLocation}</dt>
          <dd>{card.access.keyLocation ? t.stored : t.missing}</dd>
          <dt>{t.gateCode}</dt>
          <dd>{card.access.gateCode ? t.stored : t.missing}</dd>
          <dt>{t.keyBox}</dt>
          <dd>{card.access.keyBox ? t.stored : t.missing}</dd>
          {card.access.contactName || card.access.contactPhone ? (
            <>
              <dt>{t.contact}</dt>
              <dd>
                {[
                  card.access.contactName,
                  card.access.contactPhone ? formatPhone(card.access.contactPhone) : null,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </dd>
            </>
          ) : null}
        </dl>
        <AccessReveal boatId={card.id} />
      </section>
    </main>
  );
}
