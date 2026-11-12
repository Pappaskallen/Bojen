import type { Metadata } from "next";
import { sv } from "@bojen/core/i18n/sv";
import { redirect } from "next/navigation";
import { currentSession } from "../../../../lib/server";
import { safeNext } from "../../_next";
import { EnrollForm } from "./enroll-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: `${sv.secondFactor.enrollTitle} – ${sv.app.name}`,
  robots: "noindex",
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Adding an authenticator app (step 2.8): required for owners and admins, optional for others. */
export default async function EnrollPage({ searchParams }: Props) {
  const next = safeNext((await searchParams).nasta, "/sakerhet");
  const session = await currentSession();
  if (!session) {
    redirect(`/logga-in?nasta=${encodeURIComponent(`/sakerhet/tvafaktor?nasta=${next}`)}`);
  }
  // Whoever has an app proves it first, before replacing it.
  if (session.step === "challenge") {
    redirect(`/logga-in/tvafaktor?nasta=${encodeURIComponent(next)}`);
  }
  return (
    <main className="booking">
      <h1>{sv.secondFactor.enrollTitle}</h1>
      {session.step === "enroll" ? <p>{sv.secondFactor.enrollRequired}</p> : null}
      <p>{sv.secondFactor.enrollIntro}</p>
      <EnrollForm next={next} />
    </main>
  );
}
