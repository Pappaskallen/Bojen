"use client";

import { crm } from "@bojen/core/i18n/sv";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { useEffect, useState } from "react";

const t = crm.passkey;

/**
 * Adding a passkey on this phone (step 5.5c): for signing in without a code, for the lock on
 * the day view and for keeping the codes on the phone.
 */
export function PasskeySetup({ count }: { count: number }) {
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setSupported(browserSupportsWebAuthn()), []);

  async function add() {
    setBusy(true);
    setState(null);
    try {
      const start = await fetch("/api/passkey/registrera/start", { method: "POST" });
      if (!start.ok) throw new Error("start");
      const response = await startRegistration({ optionsJSON: await start.json() });
      const finish = await fetch("/api/passkey/registrera/klar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response, name: navigator.platform || null }),
      });
      const body = (await finish.json().catch(() => ({}))) as { prf?: boolean };
      if (!finish.ok) throw new Error("finish");
      setState({ text: body.prf ? t.added : t.addedNoPrf, error: false });
    } catch {
      setState({ text: t.addFailed, error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="passkeys">
      <h2 id="passkeys">{t.title}</h2>
      <p>{t.intro}</p>
      <p className="help">{t.count(count)}</p>
      {supported ? (
        <button type="button" onClick={() => void add()} disabled={busy}>
          {t.add}
        </button>
      ) : (
        <p className="help">{t.unsupported}</p>
      )}
      {state ? (
        <p role={state.error ? "alert" : "status"} className={state.error ? "error" : undefined}>
          {state.text}
        </p>
      ) : null}
    </section>
  );
}
