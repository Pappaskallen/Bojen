import type { Metadata } from "next";
import { sv } from "@bojen/core/i18n/sv";
import { listStaff } from "@bojen/db";
import { db, requireStaff, staffAuth } from "../../../lib/server";
import { SignOutButton } from "../sign-out";
import { StaffTable, type StaffRow } from "./staff-table";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: `${sv.security.title} – ${sv.app.name}`,
  robots: "noindex",
};

/** Who signs in with two factors, and the owner's tools for lost phones (step 2.8). */
export default async function SecurityPage() {
  const session = await requireStaff("/sakerhet");
  const auth = staffAuth();
  const staff = await listStaff(db(), session.context.tenantId);
  const rows: StaffRow[] = await Promise.all(
    staff.map(async (s) => ({
      id: s.id,
      name: s.name,
      role: s.role,
      signedInBefore: s.authUserId !== null,
      hasFactor: s.authUserId ? await auth.hasFactor(s.authUserId) : false,
      self: s.id === session.context.actor.id,
    })),
  );
  return (
    <main className="booking">
      <h1>{sv.security.title}</h1>
      <p>{sv.security.intro}</p>
      <SignOutButton />
      <StaffTable rows={rows} isOwner={session.role === "owner"} />
    </main>
  );
}
