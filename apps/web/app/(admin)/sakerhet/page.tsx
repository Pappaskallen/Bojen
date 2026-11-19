import type { Metadata } from "next";
import { sv } from "@bojen/core/i18n/sv";
import { AUDIO_DAY_CHOICES, RETENTION } from "@bojen/core/privacy";
import { firmAudioDays, listStaff, passkeysOf } from "@bojen/db";
import { db, requireStaff, staffAuth } from "../../../lib/server";
import { AdminNav } from "../nav";
import { SignOutButton } from "../sign-out";
import { PasskeySetup } from "./passkey-setup";
import { StaffTable, type StaffRow } from "./staff-table";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: `${sv.security.title} – ${sv.app.name}`,
  robots: "noindex",
};

/** Who signs in with two factors, and the owner's tools for lost phones (step 2.8). */
export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ ljud?: string; ljudfel?: string }>;
}) {
  const session = await requireStaff("/sakerhet");
  const query = await searchParams;
  const audio = sv.security.audio;
  const days = await firmAudioDays(db(), session.context.tenantId);
  const canChange = session.role !== "mechanic";
  const audioError =
    query.ljudfel === "forbidden"
      ? audio.onlyOwners
      : query.ljudfel === "failed"
        ? audio.failed
        : null;
  const saved = query.ljud === String(days) && !audioError;
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
      <AdminNav current="security" />
      <h1>{sv.security.title}</h1>
      <p>{sv.security.intro}</p>
      <SignOutButton />
      <PasskeySetup
        count={(await passkeysOf(db(), session.context.tenantId, session.context.actor.id)).length}
      />
      <StaffTable rows={rows} isOwner={session.role === "owner"} />

      <section aria-labelledby="ljud">
        <h2 id="ljud">{audio.heading}</h2>
        <p className="help">{audio.intro}</p>
        {audioError ? (
          <p role="alert" className="error">
            {audioError}
          </p>
        ) : null}
        {saved ? <p role="status">{audio.saved(days)}</p> : null}
        {canChange ? (
          <form method="post" action="/api/staff/inspelningar">
            <fieldset className="audio-choice">
              <legend>{audio.current(days)}</legend>
              {AUDIO_DAY_CHOICES.map((choice) => (
                <label key={choice} className="choice">
                  <input type="radio" name="days" value={choice} defaultChecked={choice === days} />
                  <span>
                    {audio.choice(choice)}
                    {choice === RETENTION.audioDays ? ` ${audio.standard}` : ""}
                  </span>
                </label>
              ))}
            </fieldset>
            <button type="submit">{audio.save}</button>
          </form>
        ) : (
          <>
            <p>{audio.current(days)}</p>
            <p className="help">{audio.onlyOwners}</p>
          </>
        )}
      </section>
    </main>
  );
}
