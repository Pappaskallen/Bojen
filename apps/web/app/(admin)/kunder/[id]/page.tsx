import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatPhone } from "@bojen/core";
import { crm, sv } from "@bojen/core/i18n/sv";
import { CARD_MESSAGES, customerCard } from "@bojen/db";
import { db, requireStaff } from "../../../../lib/server";
import { AdminNav } from "../../nav";
import { SignOutButton } from "../../sign-out";
import { boatLabel, showDate, showDateTime, word } from "../format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: `${crm.card.back} – ${sv.app.name}`,
  robots: "noindex",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const none = crm.card.unknown;

type Props = { params: Promise<{ id: string }> };

/** The customer card: contact details, boats, visits and the messages (byggplan step 5.1). */
export default async function CustomerCardPage({ params }: Props) {
  const { id } = await params;
  const staff = await requireStaff(`/kunder/${id}`);
  if (!UUID.test(id)) notFound();
  const now = new Date();
  const card = await customerCard(db(), staff.context.tenantId, id, now);
  if (!card) notFound();

  const upcoming = card.visits
    .filter((v) => v.start >= now && v.status !== "cancelled")
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const earlier = card.visits.filter((v) => !upcoming.includes(v));
  const visitList = (visits: typeof card.visits) => (
    <ul className="visit-list">
      {visits.map((v) => (
        <li key={v.id}>
          <span className="when">{showDateTime(v.start)}</span>
          <span className="status" data-status={v.status}>
            {word(crm.visitStatus, v.status)}
          </span>
          <span>{[v.service, v.boat, v.mechanic].filter(Boolean).join(" · ") || none}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <main className="booking crm">
      <AdminNav current="customers" />
      <p>
        <Link href="/kunder">{crm.card.back}</Link>
      </p>
      <h1>{card.name}</h1>
      {card.type === "private" ? null : (
        <p className="badge">{word(crm.customerType, card.type)}</p>
      )}
      <SignOutButton />

      <section aria-labelledby="contact">
        <h2 id="contact">{crm.card.contact}</h2>
        <dl className="summary">
          <dt>{crm.card.phone}</dt>
          <dd>{card.phone ? <a href={`tel:${card.phone}`}>{formatPhone(card.phone)}</a> : none}</dd>
          <dt>{crm.card.email}</dt>
          <dd>{card.email ? <a href={`mailto:${card.email}`}>{card.email}</a> : none}</dd>
          <dt>{crm.card.billingAddress}</dt>
          <dd className="pre">{card.billingAddress ?? none}</dd>
          <dt>{crm.card.language}</dt>
          <dd>{word(crm.language, card.language)}</dd>
          <dt>{crm.card.source}</dt>
          <dd>{card.acquisitionChannel ?? none}</dd>
          <dt>{crm.card.since}</dt>
          <dd>{showDate(card.createdAt)}</dd>
        </dl>
      </section>

      <section aria-labelledby="boats">
        <h2 id="boats">{crm.card.boats}</h2>
        {card.boats.length === 0 ? (
          <p>{crm.card.noBoats}</p>
        ) : (
          <ul className="boat-list">
            {card.boats.map((b) => (
              <li key={b.id}>
                <strong>{boatLabel(b)}</strong>
                <span className="badge">{word(crm.ownershipRole, b.role)}</span>
                {b.status === "active" ? null : (
                  <span className="badge">{word(crm.boatStatus, b.status)}</span>
                )}
                <span className="meta">
                  {[
                    b.lengthM ? crm.card.length(b.lengthM) : null,
                    b.year ? crm.card.year(b.year) : null,
                    b.place
                      ? `${b.place}${b.spotId ? ` ${b.spotId}` : ""}${
                          b.mode ? `, ${word(crm.placementMode, b.mode)}` : ""
                        }`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="visits">
        <h2 id="visits">{crm.card.visits}</h2>
        {card.visits.length === 0 ? <p>{crm.card.noVisits}</p> : null}
        {upcoming.length > 0 ? (
          <>
            <h3>{crm.card.upcoming}</h3>
            {visitList(upcoming)}
          </>
        ) : null}
        {earlier.length > 0 ? (
          <>
            <h3>{crm.card.earlier}</h3>
            {visitList(earlier)}
          </>
        ) : null}
      </section>

      <section aria-labelledby="timeline">
        <h2 id="timeline">{crm.card.timeline}</h2>
        {card.timeline.length === 0 ? (
          <p>{crm.card.noMessages}</p>
        ) : (
          <>
            <p className="help">{crm.card.timelineHelp(CARD_MESSAGES)}</p>
            <ol className="timeline">
              {card.timeline.map((m) => (
                <li key={m.id} data-direction={m.direction}>
                  <p className="head">
                    <time dateTime={m.at.toISOString()}>{showDateTime(m.at)}</time>
                    <span>{word(crm.message.channel, m.channel)}</span>
                    <span>
                      {m.template
                        ? word(crm.message.template, m.template)
                        : m.direction === "inbound"
                          ? crm.message.inboundFallback
                          : crm.message.outboundFallback}
                    </span>
                    <span>{word(crm.message.direction, m.direction)}</span>
                    <span>{word(crm.message.status, m.status)}</span>
                    {m.intent ? <span>{word(crm.message.intent, m.intent)}</span> : null}
                  </p>
                  {m.subject ? (
                    <p className="subject">
                      <strong>{crm.card.subject}:</strong> {m.subject}
                    </p>
                  ) : null}
                  {m.body ? <p className="body pre">{m.body.slice(0, 1500)}</p> : null}
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
    </main>
  );
}
