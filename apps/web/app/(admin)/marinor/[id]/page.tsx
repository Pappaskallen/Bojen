import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatPhone } from "@bojen/core";
import { crm, sv } from "@bojen/core/i18n/sv";
import { placeCard } from "@bojen/db";
import { appUrl, db, requireStaff } from "../../../../lib/server";
import { boatLabel, showDate, word } from "../../kunder/format";
import { AdminNav } from "../../nav";
import { SignOutButton } from "../../sign-out";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: `${crm.place.list} – ${sv.app.name}`,
  robots: "noindex",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const t = crm.place;
const none = crm.card.unknown;

type Props = { params: Promise<{ id: string }> };

const isoDay = (iso: string) => showDate(new Date(`${iso}T12:00:00Z`));

/**
 * The marina card (byggplan step 5.3, spec C3): the people there, the rules for getting in,
 * the boats there and when they go in and come up, and the marina's booking link.
 */
export default async function PlaceCardPage({ params }: Props) {
  const { id } = await params;
  const staff = await requireStaff(`/marinor/${id}`);
  if (!UUID.test(id)) notFound();
  const card = await placeCard(db(), staff.context.tenantId, id, new Date());
  if (!card) notFound();
  const bookingUrl = card.bookingPath ? `${appUrl()}${card.bookingPath}` : null;
  const dates = (title: string, rows: typeof card.launches) =>
    rows.length === 0 ? null : (
      <>
        <h3>{title}</h3>
        <ul className="date-list">
          {rows.map((d) => (
            <li key={d.date}>
              <span>{isoDay(d.date)}</span> <span className="meta">{t.dateCount(d.boats)}</span>
            </li>
          ))}
        </ul>
      </>
    );

  return (
    <main className="booking crm">
      <AdminNav current="places" />
      <p>
        <Link href="/marinor">{t.back}</Link>
      </p>
      <h1>{card.name}</h1>
      <p className="badge">{word(crm.placeType, card.type)}</p>
      <SignOutButton />

      <section aria-labelledby="about">
        <h2 id="about">{t.about}</h2>
        <dl className="summary">
          <dt>{t.address}</dt>
          <dd>{card.address ?? none}</dd>
          <dt>{t.access}</dt>
          <dd>
            {[
              word(crm.accessMethod, card.accessMethod),
              card.crossingMinutes ? t.crossing(card.crossingMinutes) : null,
            ]
              .filter(Boolean)
              .join(", ")}
          </dd>
          {card.ownerCustomer ? (
            <>
              <dt>{t.asCustomer}</dt>
              <dd>
                <Link href={`/kunder/${card.ownerCustomer.id}`}>{card.ownerCustomer.name}</Link>
              </dd>
            </>
          ) : null}
        </dl>
      </section>

      <section aria-labelledby="booking-link">
        <h2 id="booking-link">{t.bookingLink}</h2>
        {bookingUrl ? (
          <>
            <p>
              <a href={card.bookingPath ?? ""}>{bookingUrl}</a>
            </p>
            <p className="help">{t.bookingHelp}</p>
          </>
        ) : (
          <p>{t.noBookingLink}</p>
        )}
      </section>

      <section aria-labelledby="contacts">
        <h2 id="contacts">{t.contacts}</h2>
        {card.contacts.length === 0 ? (
          <p>{t.noContacts}</p>
        ) : (
          <ul className="boat-list">
            {card.contacts.map((c) => (
              <li key={c.id}>
                <strong>{c.name}</strong>
                {c.role ? <span className="badge">{c.role}</span> : null}
                <span className="meta">
                  {c.phone ? <a href={`tel:${c.phone}`}>{formatPhone(c.phone)}</a> : null}
                  {c.phone && c.email ? " · " : null}
                  {c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : null}
                </span>
                {c.note ? <span className="meta pre">{c.note}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="rules">
        <h2 id="rules">{t.rules}</h2>
        {card.rules ? (
          <>
            <dl className="summary">
              <dt>{t.openingHours}</dt>
              <dd>
                {card.rules.openingHours
                  ? Object.entries(card.rules.openingHours)
                      .map(([key, hours]) => `${t.hoursKey[key] ?? key} ${hours}`)
                      .join(", ")
                  : none}
              </dd>
              <dt>{t.checkIn}</dt>
              <dd className="pre">{card.rules.checkIn ?? none}</dd>
              <dt>{t.parking}</dt>
              <dd className="pre">{card.rules.parking ?? none}</dd>
              <dt>{t.gateCode}</dt>
              <dd>{card.rules.gateCode ? crm.boat.stored : crm.boat.missing}</dd>
              <dt>{t.keyBox}</dt>
              <dd>{card.rules.keyBox ? crm.boat.stored : crm.boat.missing}</dd>
            </dl>
            <p className="help">{t.codesNote}</p>
          </>
        ) : (
          <p>{t.noRules}</p>
        )}
      </section>

      <section aria-labelledby="dates">
        <h2 id="dates">{t.dates}</h2>
        {card.launches.length === 0 && card.haulOuts.length === 0 ? <p>{t.noDates}</p> : null}
        {dates(t.launches, card.launches)}
        {dates(t.haulOuts, card.haulOuts)}
      </section>

      <section aria-labelledby="boats">
        <h2 id="boats">{t.boats}</h2>
        {card.boats.length === 0 ? (
          <p>{t.noBoats}</p>
        ) : (
          <ul className="boat-list">
            {card.boats.map((b) => (
              <li key={`${b.boatId}-${b.season}`}>
                <strong>
                  <Link href={`/batar/${b.boatId}`}>{boatLabel(b)}</Link>
                </strong>
                {b.current ? <span className="badge">{t.here}</span> : null}
                <span className="meta">
                  {[
                    word(crm.season, b.season),
                    word(crm.placementMode, b.mode),
                    b.spotId ? crm.boat.spot(b.spotId) : null,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                  {b.owners.length > 0 ? " · " : null}
                  {b.owners.map((o, i) => (
                    <span key={o.id}>
                      {i > 0 ? ", " : null}
                      <Link href={`/kunder/${o.id}`}>{o.name}</Link>
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
