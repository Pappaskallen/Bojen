import type { Metadata } from "next";
import { formatPhone } from "@bojen/core";
import { crm, sv } from "@bojen/core/i18n/sv";
import { openTasks } from "@bojen/db";
import { db, requireStaff } from "../../../../lib/server";
import { AdminNav } from "../../../(admin)/nav";
import { SignOutButton } from "../../../(admin)/sign-out";
import { PushToggle } from "./push-toggle";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: `${crm.tasks.title} – ${sv.app.name}`,
  robots: "noindex",
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const t = crm.tasks;
const clock = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * The receptionist's messages (byggplan step 6.4): urgent first. "Jag tar det" tells the
 * others and stops the alert going on to the next mechanic on call; "Klart" closes it.
 */
export default async function TasksPage({ searchParams }: Props) {
  const staff = await requireStaff("/idag/arenden");
  const query = await searchParams;
  const tasks = await openTasks(db(), staff.context.tenantId);
  return (
    <main className="booking crm day-page">
      <AdminNav current="tasks" />
      <h1>{t.title}</h1>
      <PushToggle publicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null} />
      {query.arendefel ? (
        <p className="error" role="alert">
          {t.gone}
        </p>
      ) : null}
      {tasks.length === 0 ? (
        <p>{t.none}</p>
      ) : (
        <ol className="day-list">
          {tasks.map((task) => (
            <li key={task.id} className="day-visit" aria-label={task.title}>
              <header>
                {task.priority === "high" ? <span className="badge">{t.urgent}</span> : null}
                {task.dueAt ? <span className="when">{t.due(clock.format(task.dueAt))}</span> : null}
              </header>
              <h2>{task.title}</h2>
              {task.note ? <p className="pre">{task.note}</p> : null}
              {task.callSummary && task.callSummary !== task.note ? (
                <details>
                  <summary>{t.call}</summary>
                  <p className="pre">{task.callSummary}</p>
                </details>
              ) : null}
              {task.takenBy ? <p className="meta">{t.takenBy(task.takenBy)}</p> : null}
              <div className="actions">
                {task.phone ? (
                  <a className="button secondary" href={`tel:${task.phone}`}>
                    {t.callBack} {formatPhone(task.phone)}
                  </a>
                ) : null}
                {task.takenBy ? null : (
                  <form method="post" action={`/api/arenden/${task.id}`}>
                    <button type="submit" name="do" value="take">
                      {t.take}
                    </button>
                  </form>
                )}
                <form method="post" action={`/api/arenden/${task.id}`}>
                  <button type="submit" name="do" value="done" className="secondary">
                    {t.done}
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ol>
      )}
      <SignOutButton />
    </main>
  );
}
