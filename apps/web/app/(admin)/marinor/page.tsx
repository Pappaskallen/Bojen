import type { Metadata } from "next";
import Link from "next/link";
import { crm, sv } from "@bojen/core/i18n/sv";
import { listPlaces } from "@bojen/db";
import { db, requireStaff } from "../../../lib/server";
import { word } from "../kunder/format";
import { AdminNav } from "../nav";
import { SignOutButton } from "../sign-out";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: `${crm.place.list} – ${sv.app.name}`,
  robots: "noindex",
};

/** The firm's marinas, clubs and yards (byggplan step 5.3). All signed-in staff may read it. */
export default async function PlacesPage() {
  const staff = await requireStaff("/marinor");
  const places = await listPlaces(db(), staff.context.tenantId, new Date());
  return (
    <main className="booking crm">
      <AdminNav current="places" />
      <h1>{crm.place.list}</h1>
      <p>{crm.place.listIntro}</p>
      <SignOutButton />
      {places.length === 0 ? (
        <p role="status">{crm.place.none}</p>
      ) : (
        <ul className="customer-list">
          {places.map((p) => (
            <li key={p.id}>
              <Link href={`/marinor/${p.id}`}>
                <span className="name">{p.name}</span>
                <span className="badge">{word(crm.placeType, p.type)}</span>
                <span className="meta">
                  {[p.address, crm.place.boatsNow(p.boatsNow)].filter(Boolean).join(" · ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
