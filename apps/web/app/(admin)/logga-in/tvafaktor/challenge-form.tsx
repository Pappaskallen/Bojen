"use client";

import { sv } from "@bojen/core/i18n/sv";
import { useState, type FormEvent } from "react";

const t = sv.secondFactor;

async function post(path: string, body: unknown) {
  return fetch(`/api/auth/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
}

export function ChallengeForm({ next }: { next: string }) {
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await post(recovery ? "recover" : "mfa-challenge", { code });
    setBusy(false);
    if (response?.ok) {
      // After a recovery code the old app is gone; adding a new one comes next.
      window.location.assign(
        recovery ? `/sakerhet/tvafaktor?nasta=${encodeURIComponent(next)}` : next,
      );
      return;
    }
    setError(response?.status === 401 || response?.status === 400 ? t.wrongCode : t.failed);
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
      <label className="field">
        <span>{recovery ? t.recoveryCode : t.code}</span>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode={recovery ? "text" : "numeric"}
          autoComplete="one-time-code"
          required
        />
      </label>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={busy}>
        {recovery ? t.useCode : t.confirm}
      </button>
      {recovery ? null : (
        <p>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setRecovery(true);
              setCode("");
            }}
          >
            {t.useRecovery}
          </button>
        </p>
      )}
    </form>
  );
}
