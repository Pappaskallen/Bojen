import type { Metadata } from "next";
import { sv } from "@bojen/core/i18n/sv";
import { pendingRequests } from "@bojen/db";
import { currentStaff, db } from "../../../lib/server";
import { RequestList } from "./request-list";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: `${sv.requests.title} – ${sv.app.name}`,
  robots: "noindex",
};

/** Bookings waiting for approval (byggplan step 2.6). Staff only; sign-in is step 2.7. */
export default async function RequestsPage() {
  const staff = await currentStaff();
  if (!staff || staff.actor.type !== "staff") {
    return (
      <main className="requests booking">
        <h1>{sv.requests.title}</h1>
        <p>{sv.requests.signIn}</p>
      </main>
    );
  }
  const requests = await pendingRequests(db(), staff.tenantId);
  return (
    <main className="requests booking">
      <h1>{sv.requests.title}</h1>
      <p>{sv.requests.intro}</p>
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
