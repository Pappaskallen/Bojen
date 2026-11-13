import type { Metadata } from "next";
import { bookingSettings, dayMonth, promisedWindow, weekdayShort } from "@bojen/core";
import { customerPage as t, sv } from "@bojen/core/i18n/sv";
import { slotValue, type Done, type Problem } from "../../../../lib/customer-page";
import { customerPage } from "../../../../lib/server";

export const dynamic = "force-dynamic";

/** The code is the key to the page: keep it out of search engines and other sites' logs. */
export const metadata: Metadata = {
  title: `${t.title} – ${sv.app.name}`,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Props = {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const DONE: Record<Done, string> = {
  ombokad: t.done.rescheduled,
  avbokad: t.done.cancelled,
  atkomst: t.done.access,
};
const PROBLEMS: Record<Problem, string> = t.errors;
const pick = <K extends string>(map: Record<K, string>, value: unknown) =>
  typeof value === "string" && Object.hasOwn(map, value) ? map[value as K] : null;

const when = (start: Date, end: Date, settings: Record<string, unknown>) =>
  `${weekdayShort(start)} ${dayMonth(start)} kl ${promisedWindow(start, end, bookingSettings(settings).windows)}`;

export default async function CustomerPage({ params, searchParams }: Props) {
  const { code } = await params;
  const query = await searchParams;
  const done = pick(DONE, query.klart);
  const problem = pick(PROBLEMS, query.fel);
  const { page, times } = await customerPage.load(code);

  if (page.state !== "valid") {
    const phone = page.state === "missing" ? null : page.firm.phone;
    return (
      <div className="booking">
        <h1>{page.state === "missing" ? t.title : page.firm.name}</h1>
        {/* Right after a reschedule or a cancellation the link is used up: say it worked. */}
        {done && page.state === "used" ? (
          <p role="status">{done}</p>
        ) : (
          <p className="error" role="alert">
            {t.errors[page.state]}
          </p>
        )}
        {phone ? <p>{t.callUs(phone)}</p> : null}
      </div>
    );
  }

  const { visit } = page;
  const phone = visit.firm.phone ?? "";
  const action = (name: string) => `/api/x/${encodeURIComponent(code)}/${name}`;

  return (
    <div className="booking">
      <div className="firm">
        <h1>{visit.firm.name}</h1>
      </div>
      <h2>{t.title}</h2>
      {done ? <p role="status">{done}</p> : null}
      {problem ? (
        <p className="error" role="alert">
          {problem}
        </p>
      ) : null}

      <dl className="summary">
        <dt>{t.what}</dt>
        <dd>{visit.service?.name ?? sv.flows.unknown}</dd>
        <dt>{t.when}</dt>
        <dd>{when(visit.start, visit.end, visit.firm.settings)}</dd>
        <dt>{t.where}</dt>
        <dd>{visit.place?.name ?? sv.flows.unknown}</dd>
        {visit.boat ? (
          <>
            <dt>{t.boat}</dt>
            <dd>
              {visit.boat.name ??
                ([visit.boat.make, visit.boat.model].filter(Boolean).join(" ") || sv.flows.unknown)}
            </dd>
          </>
        ) : null}
      </dl>
      {visit.status === "pending_approval" ? <p>{t.pending}</p> : null}

      {page.mayChange ? (
        <>
          <section className="group" aria-labelledby="reschedule">
            <h2 id="reschedule">{t.reschedule}</h2>
            {times.length > 0 ? (
              <form method="post" action={action("ombokning")}>
                <fieldset>
                  <legend>{t.rescheduleIntro}</legend>
                  {times.map((s, i) => (
                    <label className="choice" key={slotValue(s)}>
                      <input
                        type="radio"
                        name="slot"
                        value={slotValue(s)}
                        defaultChecked={i === 0}
                        required
                      />
                      <span>{s.label}</span>
                    </label>
                  ))}
                </fieldset>
                <div className="actions">
                  <button type="submit">{t.chooseTime}</button>
                </div>
              </form>
            ) : (
              <p>{t.noTimes}</p>
            )}
          </section>

          <section className="group" aria-labelledby="cancel">
            <h2 id="cancel">{t.cancel}</h2>
            <p>{t.cancelIntro(page.cancelBy)}</p>
            <form method="post" action={action("avbokning")}>
              <div className="actions">
                <button type="submit" className="secondary">
                  {t.cancelConfirm}
                </button>
              </div>
            </form>
          </section>
        </>
      ) : (
        <p>{t.tooLate(page.cancelBy, phone)}</p>
      )}

      <section className="group" aria-labelledby="access">
        <h2 id="access">{t.access}</h2>
        {visit.boat ? (
          <form method="post" action={action("atkomst")} autoComplete="off">
            <p>{t.accessIntro}</p>
            {page.hasAccess ? <p>{t.accessStored}</p> : null}
            <label className="field">
              <span>{t.accessCode}</span>
              <input name="code" type="text" maxLength={200} autoComplete="off" />
            </label>
            <label className="field">
              <span>{t.keyLocation}</span>
              <input name="keyLocation" type="text" maxLength={200} autoComplete="off" />
            </label>
            <div className="actions">
              <button type="submit">{t.accessSave}</button>
            </div>
          </form>
        ) : (
          <p>{t.noBoat}</p>
        )}
      </section>
    </div>
  );
}
