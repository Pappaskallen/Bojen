"use client";

import { crm } from "@bojen/core/i18n/sv";
import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import { useEffect, useState } from "react";

const t = crm.passkey;

/** Sign-in with a passkey (step 5.5c): Face ID, fingerprint or the phone's PIN, no code. */
export function PasskeySignIn({ next }: { next: string }) {
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setSupported(browserSupportsWebAuthn()), []);
  if (!supported) return null;

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const start = await fetch("/api/passkey/logga-in/start", { method: "POST" });
      if (!start.ok) throw new Error("start");
      const response = await startAuthentication({ optionsJSON: await start.json() });
      const finish = await fetch("/api/passkey/logga-in/klar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response }),
      });
      if (!finish.ok) throw new Error("finish");
      window.location.assign(next);
    } catch {
      setError(t.signInFailed);
      setBusy(false);
    }
  }

  return (
    <div className="passkey-sign-in">
      <button type="button" onClick={() => void signIn()} disabled={busy}>
        {t.signIn}
      </button>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      <p className="help">{t.or}</p>
    </div>
  );
}
