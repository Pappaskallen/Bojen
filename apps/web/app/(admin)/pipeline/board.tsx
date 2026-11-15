"use client";

import { PIPELINE_COLUMNS, type PipelineColumn } from "@bojen/core/pipeline";
import { crm } from "@bojen/core/i18n/sv";
import Link from "next/link";
import { useState, type DragEvent } from "react";

export interface BoardCard {
  jobId: string;
  status: PipelineColumn;
  customerId: string;
  customer: string;
  boatId: string | null;
  boat: string | null;
  service: string | null;
  visitStart: string | null;
  canMove: boolean;
}

const t = crm.pipeline;
const when = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  weekday: "short",
  day: "numeric",
  month: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const SETTLED: readonly PipelineColumn[] = ["done", "invoiced", "paid"];

/**
 * The board (step 5.4). A card moves by drag and drop, or by the list on the card, which also
 * works with a keyboard and on a phone. The card moves at once and goes back if the server
 * says no.
 */
export function Board({
  cards: initial,
  settledLimit,
}: {
  cards: BoardCard[];
  settledLimit: number;
}) {
  const [cards, setCards] = useState(initial);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [over, setOver] = useState<PipelineColumn | null>(null);

  async function move(jobId: string, to: PipelineColumn) {
    const card = cards.find((c) => c.jobId === jobId);
    if (!card || card.status === to || !card.canMove) return;
    const from = card.status;
    setCards((all) => all.map((c) => (c.jobId === jobId ? { ...c, status: to } : c)));
    try {
      const response = await fetch(`/api/pipeline/${encodeURIComponent(jobId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to }),
      });
      if (!response.ok) throw new Error(String(response.status));
      setMessage({ text: t.moved(t.columns[to] ?? to), error: false });
    } catch (error) {
      setCards((all) => all.map((c) => (c.jobId === jobId ? { ...c, status: from } : c)));
      setMessage({
        text: error instanceof Error && error.message === "403" ? t.forbidden : t.failed,
        error: true,
      });
    }
  }

  const onDrop = (column: PipelineColumn) => (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setOver(null);
    const jobId = event.dataTransfer.getData("text/plain");
    if (jobId) void move(jobId, column);
  };

  return (
    <>
      <p className={message?.error ? "error" : "help"} role={message?.error ? "alert" : "status"}>
        {message?.text ?? ""}
      </p>
      <div className="board">
        {PIPELINE_COLUMNS.map((column) => {
          const here = cards.filter((c) => c.status === column);
          return (
            <section
              key={column}
              className={`column${over === column ? " over" : ""}`}
              aria-labelledby={`col-${column}`}
              data-column={column}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(column);
              }}
              onDragLeave={() => setOver((o) => (o === column ? null : o))}
              onDrop={onDrop(column)}
            >
              <h2 id={`col-${column}`}>
                {t.columns[column]} <span className="count">{t.count(here.length)}</span>
              </h2>
              {here.length === 0 ? <p className="help">{t.empty}</p> : null}
              <ul>
                {here.map((c) => (
                  <li
                    key={c.jobId}
                    className="card"
                    draggable={c.canMove}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", c.jobId);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    data-job={c.jobId}
                  >
                    <Link href={`/kunder/${c.customerId}`} className="name">
                      {c.customer}
                    </Link>
                    {c.boat && c.boatId ? (
                      <Link href={`/batar/${c.boatId}`} className="meta">
                        {c.boat}
                      </Link>
                    ) : null}
                    <span className="meta">{c.service ?? crm.card.unknown}</span>
                    <span className="meta">
                      {c.visitStart ? when.format(new Date(c.visitStart)) : t.noVisit}
                    </span>
                    {c.canMove ? (
                      <label className="move">
                        <span>{t.moveTo}</span>
                        <select
                          value={c.status}
                          onChange={(e) => void move(c.jobId, e.target.value as PipelineColumn)}
                          aria-label={`${t.moveTo}: ${c.customer}`}
                        >
                          {PIPELINE_COLUMNS.map((to) => (
                            <option key={to} value={to}>
                              {t.columns[to]}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </li>
                ))}
              </ul>
              {SETTLED.includes(column) && here.length >= settledLimit ? (
                <p className="help">{t.settledNote(settledLimit)}</p>
              ) : null}
            </section>
          );
        })}
      </div>
    </>
  );
}
