"use client";

import { sv } from "@bojen/core/i18n/sv";
import { useState, type FormEvent } from "react";

const t = sv.signIn;

type Method = "email" | "sms";

export function SignInForm({ next }: { next: string }) {
  const [method, setMethod] = useState<Method>("email");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
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
    const who = method === "sms" ? { phone } : { email };
    if (!sent) {
      const response = await post("code", who);
      setBusy(false);
      if (response?.ok) setSent(true);
      else setError(t.failed);
      return;
    }
    const response = await post("verify", { ...who, code });
    setBusy(false);
    if (response?.ok) window.location.assign(next);
    else setError(response?.status === 401 || response?.status === 400 ? t.wrongCode : t.failed);
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
      {sent ? null : (
        <fieldset>
          <legend>{t.method}</legend>
          <div className="toggle">
            {(["email", "sms"] as const).map((m) => (
              <label key={m} className="choice">
                <input
                  type="radio"
                  name="method"
                  value={m}
                  checked={method === m}
                  onChange={() => setMethod(m)}
                />
                {m === "email" ? t.byEmail : t.bySms}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {method === "email" ? (
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
      ) : (
        <label className="field">
          <span>{t.mobile}</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
            inputMode="tel"
            readOnly={sent}
            required
          />
        </label>
      )}
      {sent ? (
        <>
          <p aria-live="polite">{method === "sms" ? t.codeSentSms : t.codeSent}</p>
          <label className="field">
            <span>{method === "sms" ? t.codeSms : t.code}</span>
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
