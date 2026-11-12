import type { Metadata } from "next";
import { sv } from "@bojen/core/i18n/sv";
import { pendingRequests } from "@bojen/db";
import { currentStaff, db } from "../../../lib/server";
import { redirect } from "next/navigation";
import { SignOutButton } from "../sign-out";
import { RequestList } from "./request-list";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: `${sv.requests.title} – ${sv.app.name}`,
  robots: "noindex",
};

/** Bookings waiting for approval (byggplan step 2.6). Staff only (step 2.7). */
export default async function RequestsPage() {
  const staff = await currentStaff();
  if (!staff || staff.actor.type !== "staff") redirect("/logga-in?nasta=/forfragningar");
  const requests = await pendingRequests(db(), staff.tenantId);
  return (
    <main className="requests booking">
      <h1>{sv.requests.title}</h1>
      <p>{sv.requests.intro}</p>
      <SignOutButton />
      <RequestList
        requests={requests.map((r) => ({
          ...r,
          start: r.start.toISOString(),
          end: r.end.toISOString(),
        }))}
      />
    </main>
  );
}
