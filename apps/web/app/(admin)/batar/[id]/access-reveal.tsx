"use client";

import { crm } from "@bojen/core/i18n/sv";
import { useEffect, useState } from "react";
import type { ShownAccess } from "../../../../lib/boat-access";

/** How long the codes stay on the screen (spec 10.4). */
const SHOW_SECONDS = 60;

type State =
  | { step: "idle" }
  | { step: "confirm" }
  | { step: "loading" }
  | { step: "shown"; access: ShownAccess; left: number }
  | { step: "denied"; reason: string };

const t = crm.boat;

/**
 * The button that shows the codes (step 5.2): a confirmation first, then the codes for 60
 * seconds, then hidden again. The codes are only ever in this component's memory: they are
 * fetched on the click, never part of the page, and dropped when they are hidden.
 */
export function AccessReveal({ boatId }: { boatId: string }) {
  const [state, setState] = useState<State>({ step: "idle" });

  useEffect(() => {
    if (state.step !== "shown") return;
    if (state.left <= 0) {
      setState({ step: "idle" });
      return;
    }
    const timer = setTimeout(
      () => setState((s) => (s.step === "shown" ? { ...s, left: s.left - 1 } : s)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [state]);

  async function reveal() {
    setState({ step: "loading" });
    try {
      const response = await fetch(`/api/batar/${encodeURIComponent(boatId)}/atkomst`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
        cache: "no-store",
      });
      const body = (await response.json().catch(() => ({}))) as Partial<ShownAccess> & {
        reason?: string;
      };
      if (!response.ok) {
        setState({ step: "denied", reason: body.reason ?? "failed" });
        return;
      }
      setState({ step: "shown", access: body as ShownAccess, left: SHOW_SECONDS });
    } catch {
      setState({ step: "denied", reason: "failed" });
    }
  }

  if (state.step === "confirm") {
    return (
      <div className="access-confirm" role="group" aria-label={t.show}>
        <p>{t.confirm}</p>
        <div className="actions">
          <button type="button" onClick={() => void reveal()}>
            {t.confirmYes}
          </button>
          <button type="button" className="secondary" onClick={() => setState({ step: "idle" })}>
            {t.confirmNo}
          </button>
        </div>
      </div>
    );
  }

  if (state.step === "shown") {
    const a = state.access;
    const row = (label: string, value: string | null) =>
      value ? (
        <>
          <dt>{label}</dt>
          <dd className="secret">{value}</dd>
        </>
      ) : null;
    return (
      <div className="access-shown" role="region" aria-label={t.access}>
        <dl className="summary">
          {row(t.code, a.code)}
          {row(t.keyLocation, a.keyLocation)}
          {row(t.gateCode, a.gateCode)}
          {row(t.keyBox, a.keyBox)}
        </dl>
        <p className="help" aria-live="polite">
          {t.hidesIn(state.left)}
        </p>
        <button type="button" className="secondary" onClick={() => setState({ step: "idle" })}>
          {t.hide}
        </button>
      </div>
    );
  }

  return (
    <div>
      {state.step === "denied" ? (
        <p className="error" role="alert">
          {t.denied[state.reason] ?? t.denied.failed}
        </p>
      ) : null}
      <button
        type="button"
        disabled={state.step === "loading"}
        onClick={() => setState({ step: "confirm" })}
      >
        {state.step === "loading" ? t.loading : t.show}
      </button>
    </div>
  );
}
