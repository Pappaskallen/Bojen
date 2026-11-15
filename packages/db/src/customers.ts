/**
 * The customer list, the search and the customer card (byggplan step 5.1, spec C8). Read
 * only. Every query names the firm, so a signed-in member of one firm never sees another's
 * customers; the isolation tests cover the tables themselves.
 *
 * The search reads one text per customer (`customer_search`, kept up to date by triggers) with a
 * trigram index, so it answers in milliseconds with thousands of customers.
 */
import { containsPattern, parseSearch, stockholmDate, type SearchTerm } from "@bojen/core";
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { Database } from "./client";
import {
  appUser,
  boat,
  boatOwnership,
  boatPlacement,
  customer,
  job,
  location,
  message,
  serviceType,
  visit,
} from "./schema";

type Db = Pick<Database, "select" | "execute">;

export const PAGE_SIZE = 50;

export interface BoatSummary {
  id: string;
  name: string | null;
  make: string | null;
  model: string | null;
  /** The marina or place where the boat is today, if it is placed. */
  place: string | null;
}

export interface CustomerRow {
  id: string;
  name: string;
  type: string;
  phone: string | null;
  email: string | null;
  boats: BoatSummary[];
}

export interface CustomerPage {
  rows: CustomerRow[];
  /** There is a next page. */
  hasMore: boolean;
}

/**
 * What one word of the query must match: the customer's searchable text (`customer_search`),
 * where the number may also be written without the plus sign.
 */
function matchesWord(term: SearchTerm): SQL {
  const text = sql`s.document ilike ${containsPattern(term.text)}`;
  return term.phone
    ? sql`(${text} or s.document ilike ${containsPattern(term.phone)})`
    : sql`(${text})`;
}

/** The boats of these customers, with where each is today. */
async function boatsOf(
  db: Db,
  tenantId: string,
  customerIds: readonly string[],
  today: string,
): Promise<Map<string, BoatSummary[]>> {
  const byCustomer = new Map<string, BoatSummary[]>();
  if (customerIds.length === 0) return byCustomer;
  const rows = await db
    .select({
      customerId: boatOwnership.customerId,
      id: boat.id,
      name: boat.name,
      make: boat.make,
      model: boat.model,
      place: location.name,
    })
    .from(boatOwnership)
    .innerJoin(
      boat,
      and(
        eq(boat.tenantId, boatOwnership.tenantId),
        eq(boat.id, boatOwnership.boatId),
        isNull(boat.deletedAt),
      ),
    )
    .leftJoin(
      boatPlacement,
      and(
        eq(boatPlacement.tenantId, boat.tenantId),
        eq(boatPlacement.boatId, boat.id),
        sql`${boatPlacement.validDuring} @> ${today}::date`,
        isNull(boatPlacement.deletedAt),
      ),
    )
    .leftJoin(
      location,
      and(eq(location.tenantId, boatPlacement.tenantId), eq(location.id, boatPlacement.locationId)),
    )
    .where(
      and(
        eq(boatOwnership.tenantId, tenantId),
        inArray(boatOwnership.customerId, [...customerIds]),
        isNull(boatOwnership.deletedAt),
      ),
    )
    .orderBy(asc(boat.name), asc(boat.id));
  for (const { customerId, ...summary } of rows) {
    const list = byCustomer.get(customerId) ?? [];
    if (!list.some((b) => b.id === summary.id)) list.push(summary);
    byCustomer.set(customerId, list);
  }
  return byCustomer;
}

type FoundCustomer = {
  id: string;
  name: string;
  type: string;
  phone: string | null;
  email: string | null;
};

/** The query behind the list and the search; also what the speed tests ask the planner about. */
export function customerSearchSql(tenantId: string, query: string, page = 1): SQL {
  const words = parseSearch(query).map(matchesWord);
  const matches = words.length > 0 ? sql.join(words, sql` and `) : sql`true`;
  return sql`
    select c.id, c.name, c.type, c.phone, c.email
    from customer c
    join customer_search s on s.tenant_id = c.tenant_id and s.customer_id = c.id
    where c.tenant_id = ${tenantId} and c.deleted_at is null and ${matches}
    order by lower(c.name), c.id
    limit ${PAGE_SIZE + 1} offset ${(Math.max(1, Math.floor(page)) - 1) * PAGE_SIZE}`;
}

/**
 * The customer list, alphabetical, or the customers a search matches. Every word of the query
 * must match somewhere in the customer's text: the name, phone number or e-mail, a boat's name,
 * make, model or registration number, an engine's or drive's make, model or serial number, or
 * the name of the marina where a boat is placed. `page` starts at 1.
 */
export async function searchCustomers(
  db: Db,
  tenantId: string,
  query: string,
  options: { now: Date; page?: number },
): Promise<CustomerPage> {
  const found = (await db.execute<FoundCustomer>(
    customerSearchSql(tenantId, query, options.page ?? 1),
  )) as unknown as FoundCustomer[];

  const shown = found.slice(0, PAGE_SIZE);
  const boats = await boatsOf(
    db,
    tenantId,
    shown.map((c) => c.id),
    stockholmDate(options.now),
  );
  return {
    rows: shown.map((c) => ({ ...c, boats: boats.get(c.id) ?? [] })),
    hasMore: found.length > PAGE_SIZE,
  };
}

export interface CardBoat extends BoatSummary {
  role: string;
  status: string;
  lengthM: string | null;
  year: number | null;
  /** `water`, `land` or `indoor`, where the boat is today. */
  mode: string | null;
  spotId: string | null;
}

export interface CardVisit {
  id: string;
  jobId: string;
  start: Date;
  end: Date;
  status: string;
  service: string | null;
  boat: string | null;
  mechanic: string | null;
}

export interface TimelineMessage {
  id: string;
  channel: string;
  direction: string;
  template: string | null;
  subject: string | null;
  body: string | null;
  status: string;
  intent: string | null;
  /** When it was sent or received. */
  at: Date;
}

export interface CustomerCard {
  id: string;
  name: string;
  type: string;
  phone: string | null;
  email: string | null;
  billingAddress: string | null;
  acquisitionChannel: string | null;
  language: string;
  createdAt: Date;
  boats: CardBoat[];
  visits: CardVisit[];
  /** Newest first. */
  timeline: TimelineMessage[];
}

export const CARD_VISITS = 50;
export const CARD_MESSAGES = 100;

/** Everything the customer card shows, or null when the customer is not this firm's. */
export async function customerCard(
  db: Db,
  tenantId: string,
  customerId: string,
  now: Date,
): Promise<CustomerCard | null> {
  const [c] = await db
    .select()
    .from(customer)
    .where(
      and(eq(customer.tenantId, tenantId), eq(customer.id, customerId), isNull(customer.deletedAt)),
    );
  if (!c) return null;
  const today = stockholmDate(now);

  const boatRows = await db
    .select({
      id: boat.id,
      name: boat.name,
      make: boat.make,
      model: boat.model,
      status: boat.status,
      lengthM: boat.lengthM,
      year: boat.year,
      role: boatOwnership.role,
      place: location.name,
      mode: boatPlacement.mode,
      spotId: boatPlacement.spotId,
    })
    .from(boatOwnership)
    .innerJoin(
      boat,
      and(
        eq(boat.tenantId, boatOwnership.tenantId),
        eq(boat.id, boatOwnership.boatId),
        isNull(boat.deletedAt),
      ),
    )
    .leftJoin(
      boatPlacement,
      and(
        eq(boatPlacement.tenantId, boat.tenantId),
        eq(boatPlacement.boatId, boat.id),
        sql`${boatPlacement.validDuring} @> ${today}::date`,
        isNull(boatPlacement.deletedAt),
      ),
    )
    .leftJoin(
      location,
      and(eq(location.tenantId, boatPlacement.tenantId), eq(location.id, boatPlacement.locationId)),
    )
    .where(
      and(
        eq(boatOwnership.tenantId, tenantId),
        eq(boatOwnership.customerId, customerId),
        isNull(boatOwnership.deletedAt),
      ),
    )
    .orderBy(asc(boat.name), asc(boat.id));
  const seen = new Set<string>();
  const boats: CardBoat[] = boatRows.filter((b) => !seen.has(b.id) && seen.add(b.id));

  const visits = await db
    .select({
      id: visit.id,
      jobId: job.id,
      start: sql<Date>`lower(${visit.timeWindow})`.mapWith((v: string) => new Date(v)),
      end: sql<Date>`upper(${visit.timeWindow})`.mapWith((v: string) => new Date(v)),
      status: visit.status,
      service: serviceType.name,
      boatName: boat.name,
      boatMake: boat.make,
      boatModel: boat.model,
      mechanic: appUser.name,
    })
    .from(visit)
    .innerJoin(job, and(eq(job.tenantId, visit.tenantId), eq(job.id, visit.jobId)))
    .leftJoin(
      serviceType,
      and(eq(serviceType.tenantId, job.tenantId), eq(serviceType.id, job.serviceTypeId)),
    )
    .leftJoin(boat, and(eq(boat.tenantId, job.tenantId), eq(boat.id, job.boatId)))
    .leftJoin(appUser, and(eq(appUser.tenantId, visit.tenantId), eq(appUser.id, visit.mechanicId)))
    .where(
      and(
        eq(visit.tenantId, tenantId),
        eq(job.customerId, customerId),
        isNull(visit.deletedAt),
        isNull(job.deletedAt),
      ),
    )
    .orderBy(desc(sql`lower(${visit.timeWindow})`))
    .limit(CARD_VISITS);

  const timeline = await db
    .select({
      id: message.id,
      channel: message.channel,
      direction: message.direction,
      template: message.template,
      subject: message.subject,
      body: message.body,
      status: message.status,
      intent: message.intent,
      at: sql<Date>`coalesce(${message.sentAt}, ${message.createdAt})`.mapWith(
        (v: string) => new Date(v),
      ),
    })
    .from(message)
    .where(
      and(
        eq(message.tenantId, tenantId),
        eq(message.customerId, customerId),
        isNull(message.deletedAt),
      ),
    )
    .orderBy(desc(sql`coalesce(${message.sentAt}, ${message.createdAt})`))
    .limit(CARD_MESSAGES);

  return {
    id: c.id,
    name: c.name,
    type: c.type,
    phone: c.phone,
    email: c.email,
    billingAddress: c.billingAddress,
    acquisitionChannel: c.acquisitionChannel,
    language: c.language,
    createdAt: c.createdAt,
    boats,
    visits: visits.map(({ boatName, boatMake, boatModel, ...v }) => ({
      ...v,
      boat: boatName ?? ([boatMake, boatModel].filter(Boolean).join(" ") || null),
    })),
    timeline,
  };
}
