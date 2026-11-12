"use client";

import { sv } from "@bojen/core/i18n/sv";
import { useState } from "react";

const t = sv.requests;

export interface RequestRow {
  visitId: string;
  start: string;
  end: string;
  customerName: string;
  service: string | null;
  boat: string | null;
  notes: string | null;
  photos: number;
}

const when = new Intl.DateTimeFormat("sv-SE", {
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Stockholm",
});

function newKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/** The list with Approve and Reject; each answer is sent once with its own idempotency key. */
export function RequestList({ requests }: { requests: RequestRow[] }) {
  const [status, setStatus] = useState<Record<string, string>>({});

  async function answer(visitId: string, action: "approve" | "reject") {
    const response = await fetch(`/api/bookings/${visitId}/${action}`, {
      method: "POST",
      headers: { "idempotency-key": newKey() },
    }).catch(() => null);
    setStatus((s) => ({
      ...s,
      [visitId]: response?.ok ? (action === "approve" ? t.approved : t.rejected) : t.failed,
    }));
  }

  if (requests.length === 0) return <p>{t.none}</p>;
  return (
    <ul className="request-list">
      {requests.map((r) => (
        <li key={r.visitId}>
          <h2>
            {r.customerName}
            {r.service ? ` – ${r.service}` : ""}
          </h2>
          <p>{when.format(new Date(r.start))}</p>
          {r.boat ? <p>{r.boat}</p> : null}
          {r.notes ? <p>{r.notes}</p> : null}
          {r.photos > 0 ? <p>{t.photos(r.photos)}</p> : null}
          {status[r.visitId] ? (
            <p role="status">{status[r.visitId]}</p>
          ) : (
            <div className="actions">
              <button type="button" onClick={() => void answer(r.visitId, "approve")}>
                {t.approve}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => void answer(r.visitId, "reject")}
              >
                {t.reject}
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
