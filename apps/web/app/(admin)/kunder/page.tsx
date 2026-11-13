import type { Metadata } from "next";
import Link from "next/link";
import { formatPhone } from "@bojen/core";
import { crm, sv } from "@bojen/core/i18n/sv";
import { PAGE_SIZE, searchCustomers } from "@bojen/db";
import { db, requireStaff } from "../../../lib/server";
import { AdminNav } from "../nav";
import { SignOutButton } from "../sign-out";
import { boatLabel, word } from "./format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: `${crm.list.title} – ${sv.app.name}`,
  robots: "noindex",
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";

/** The customer list with search (byggplan step 5.1). All signed-in staff may read it. */
export default async function CustomersPage({ searchParams }: Props) {
  const staff = await requireStaff("/kunder");
  const params = await searchParams;
  const query = first(params.q).slice(0, 100);
  const page = Math.max(1, Math.min(10_000, Number.parseInt(first(params.sida), 10) || 1));
  const { rows, hasMore } = await searchCustomers(db(), staff.context.tenantId, query, {
    now: new Date(),
    page,
  });

  const link = (to: number) => {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (to > 1) search.set("sida", String(to));
    const text = search.toString();
    return text ? `/kunder?${text}` : "/kunder";
  };
  const from = (page - 1) * PAGE_SIZE + 1;

  return (
    <main className="booking crm">
      <AdminNav current="customers" />
      <h1>{crm.list.title}</h1>
      <SignOutButton />

      <form method="get" action="/kunder" role="search" className="customer-search">
        <label htmlFor="q">{crm.list.searchLabel}</label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={query}
          maxLength={100}
          autoComplete="off"
          aria-describedby="q-help"
        />
        <button type="submit">{crm.list.searchButton}</button>
        <p id="q-help" className="help">
          {crm.list.searchHelp}
        </p>
      </form>

      {query ? (
        <p className="results-for">
          {crm.list.resultsFor(query)} · <Link href="/kunder">{crm.list.showAll}</Link>
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p role="status">{query || page > 1 ? crm.list.none : crm.list.noneYet}</p>
      ) : (
        <>
          <ul className="customer-list">
            {rows.map((c) => (
              <li key={c.id}>
                <Link href={`/kunder/${c.id}`}>
                  <span className="name">{c.name}</span>
                  {c.type === "private" ? null : (
                    <span className="badge">{word(crm.customerType, c.type)}</span>
                  )}
                  <span className="meta">
                    {[c.phone ? formatPhone(c.phone) : null, c.email].filter(Boolean).join(" · ")}
                  </span>
                  <span className="boats">
                    {c.boats.length === 0
                      ? crm.list.noBoats
                      : c.boats
                          .map((b) => (b.place ? `${boatLabel(b)} – ${b.place}` : boatLabel(b)))
                          .join(" · ")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <nav className="pager" aria-label={crm.list.range(from, from + rows.length - 1)}>
            {page > 1 ? <Link href={link(page - 1)}>{crm.list.previous}</Link> : <span />}
            <span>{crm.list.range(from, from + rows.length - 1)}</span>
            {hasMore ? <Link href={link(page + 1)}>{crm.list.next}</Link> : <span />}
          </nav>
        </>
      )}
    </main>
  );
}
