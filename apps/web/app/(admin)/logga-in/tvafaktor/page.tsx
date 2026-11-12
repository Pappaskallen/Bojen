import type { Metadata } from "next";
import { sv } from "@bojen/core/i18n/sv";
import { redirect } from "next/navigation";
import { currentSession } from "../../../../lib/server";
import { safeNext } from "../../_next";
import { ChallengeForm } from "./challenge-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: `${sv.secondFactor.challengeTitle} – ${sv.app.name}`,
  robots: "noindex",
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The second step of signing in, for staff who have an authenticator app (step 2.8). */
export default async function ChallengePage({ searchParams }: Props) {
  const next = safeNext((await searchParams).nasta);
  const session = await currentSession();
  if (!session) redirect(`/logga-in?nasta=${encodeURIComponent(next)}`);
  if (session.step === "none") redirect(next);
  if (session.step === "enroll") redirect(`/sakerhet/tvafaktor?nasta=${encodeURIComponent(next)}`);
  return (
    <main className="booking">
      <h1>{sv.secondFactor.challengeTitle}</h1>
      <p>{sv.secondFactor.challengeIntro}</p>
      <ChallengeForm next={next} />
    </main>
  );
}
