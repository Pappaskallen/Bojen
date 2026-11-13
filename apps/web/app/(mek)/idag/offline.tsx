"use client";

import { crm } from "@bojen/core/i18n/sv";
import { useCallback, useEffect, useState } from "react";
import { fieldsOf, flushQueue, formDataOf, indexedDbStore, type QueuedForm } from "./queue";

const t = crm.day.offline;

/** Sends one queued form; the route answers JSON when asked (lib/day-route.ts). */
async function send(item: QueuedForm) {
  const response = await fetch(item.url, {
    method: "POST",
    body: formDataOf(item.fields),
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });
  const body = (await response.json().catch(() => ({}))) as { problem?: string };
  return { status: response.status, ...(body.problem ? { problem: body.problem } : {}) };
}

const newId = () =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${String(Date.now())}-${Math.random().toString(16).slice(2)}`;

/**
 * The day view without coverage (byggplan step 5.5b). It registers the service worker, which
 * keeps the page on the phone, and takes over the page's forms: each gets a new key, is sent
 * at once when there is coverage, and otherwise waits in IndexedDB until the network is back,
 * when everything is sent in order and the page reloads with the new state.
 */
export function OfflineQueue() {
  const [waiting, setWaiting] = useState(0);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);

  const count = useCallback(async () => {
    setWaiting((await indexedDbStore.all().catch(() => [])).length);
  }, []);

  const flush = useCallback(async () => {
    const before = (await indexedDbStore.all().catch(() => [])).length;
    if (before === 0) return;
    setNote({ text: t.sending, error: false });
    const result = await flushQueue(indexedDbStore, send);
    await count();
    if (result.signInNeeded) {
      setNote({ text: t.signIn, error: true });
      return;
    }
    if (result.refused.length > 0) {
      setNote({
        text: result.refused
          .map((r) => t.refused(r.label, crm.day.errors[r.problem] ?? crm.day.errors.failed ?? ""))
          .join(" "),
        error: true,
      });
    }
    // Everything is through: show the day as it is now.
    if (result.left === 0 && result.sent > 0 && result.refused.length === 0) {
      window.location.assign(`/idag?klart=synk${window.location.hash}`);
    }
  }, [count]);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    }
    void count().then(() => (navigator.onLine ? flush() : undefined));
    const online = () => void flush();
    window.addEventListener("online", online);

    const submit = (event: SubmitEvent) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !form.dataset.offline) return;
      event.preventDefault();
      // A new key for every sending: the page may be an old copy, with old keys in it.
      const key = form.querySelector<HTMLInputElement>('input[name="key"]');
      if (key) key.value = newId();
      const item: QueuedForm = {
        id: newId(),
        url: form.action,
        fields: fieldsOf(new FormData(form)),
        createdAt: Date.now(),
        label: form.dataset.offline,
      };
      const queue = async () => {
        await indexedDbStore.put(item);
        await count();
        setNote({ text: t.saved, error: false });
        form.reset();
      };
      if (!navigator.onLine) {
        void queue();
        return;
      }
      void send(item)
        .then(async (answer) => {
          if (answer.status >= 200 && answer.status < 300) {
            const action = item.url.split("/").pop() ?? "";
            const visit = item.url.split("/").at(-2) ?? "";
            window.location.assign(`/idag?klart=${action}#besok-${visit}`);
          } else if (answer.status >= 500) {
            await queue();
          } else {
            setNote({
              text: crm.day.errors[answer.problem ?? ""] ?? crm.day.errors.failed ?? "",
              error: true,
            });
          }
        })
        .catch(queue);
    };
    document.addEventListener("submit", submit);
    return () => {
      window.removeEventListener("online", online);
      document.removeEventListener("submit", submit);
    };
  }, [count, flush]);

  return (
    <div className="offline-queue">
      {waiting > 0 ? (
        <p className="queued" role="status" aria-live="polite">
          {t.waiting(waiting)}
        </p>
      ) : null}
      {note ? (
        <p className={note.error ? "error" : "help"} role={note.error ? "alert" : "status"}>
          {note.text}
        </p>
      ) : null}
    </div>
  );
}
