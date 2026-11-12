"use client";

import { sv } from "@bojen/core/i18n/sv";
import { useEffect, useState, type FormEvent } from "react";

const t = sv.secondFactor;

interface Enrollment {
  factorId: string;
  qrSvg: string;
  secret: string;
}

export function EnrollForm({ next }: { next: string }) {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/auth/mfa-enroll", { method: "POST" })
      .then(async (r) => {
        if (!r.ok) throw new Error("enroll");
        return (await r.json()) as Enrollment;
      })
      .then(setEnrollment)
      .catch(() => setError(t.failed));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!enrollment) return;
    setBusy(true);
    setError(null);
    const response = await fetch("/api/auth/mfa-verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ factorId: enrollment.factorId, code }),
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      setError(response?.status === 401 || response?.status === 400 ? t.wrongCode : t.failed);
      return;
    }
    const body = (await response.json()) as { recoveryCodes: string[] | null };
    if (body.recoveryCodes) setCodes(body.recoveryCodes);
    else window.location.assign(next);
  }

  if (codes) {
    return (
      <section>
        <h2>{t.recoveryTitle}</h2>
        <p>{t.recoveryIntro}</p>
        <ul className="recovery-codes" aria-label={t.recoveryTitle}>
          {codes.map((c) => (
            <li key={c}>
              <code>{c}</code>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => window.location.assign(next)}>
          {t.continue}
        </button>
      </section>
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
      {enrollment ? (
        <>
          {/* The QR code is SVG from Supabase Auth, shown as an image so no markup runs. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:image/svg+xml;utf8,${encodeURIComponent(enrollment.qrSvg)}`}
            alt="QR-kod för appen"
            width={200}
            height={200}
          />
          <p>
            {t.secret} <code data-testid="totp-secret">{enrollment.secret}</code>
          </p>
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
      <button type="submit" disabled={busy || !enrollment}>
        {t.confirm}
      </button>
    </form>
  );
}
