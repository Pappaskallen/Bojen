"use client";

import { sv } from "@bojen/core/i18n/sv";
import { useState, type FormEvent } from "react";

const t = sv.signIn;

export function SignInForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function post(path: string, body: unknown) {
    return fetch(`/api/auth/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    if (!sent) {
      const response = await post("code", { email });
      setBusy(false);
      if (response?.ok) setSent(true);
      else setError(t.failed);
      return;
    }
    const response = await post("verify", { email, code });
    setBusy(false);
    if (response?.ok) window.location.assign(next);
    else setError(response?.status === 401 || response?.status === 400 ? t.wrongCode : t.failed);
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
      <label className="field">
        <span>{t.email}</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          readOnly={sent}
          required
        />
      </label>
      {sent ? (
        <>
          <p aria-live="polite">{t.codeSent}</p>
          <label className="field">
            <span>{t.code}</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              required
            />
          </label>
        </>
      ) : null}
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={busy}>
        {sent ? t.verify : t.sendCode}
      </button>
    </form>
  );
}
