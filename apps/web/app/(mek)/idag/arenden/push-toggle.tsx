"use client";

import { useEffect, useState } from "react";
import { crm } from "@bojen/core/i18n/sv";

const t = crm.tasks.push;

type State = "unknown" | "unsupported" | "blocked" | "off" | "on" | "failed";

/** The VAPID public key as the bytes the browser wants. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + "===".slice((base64url.length + 3) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * Turns on web push for this phone (step 6.4). On an iPhone this only works once Bojen is on
 * the home screen; the button says so instead of failing quietly.
 */
export function PushToggle({ publicKey }: { publicKey: string | null }) {
  const [state, setState] = useState<State>("unknown");

  useEffect(() => {
    if (!publicKey || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("blocked");
      return;
    }
    void navigator.serviceWorker.ready
      .then((r) => r.pushManager.getSubscription())
      .then((s) => setState(s ? "on" : "off"))
      .catch(() => setState("off"));
  }, [publicKey]);

  async function turnOn() {
    if (!publicKey) return;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(publicKey),
        }));
      const response = await fetch("/api/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      setState(response.ok ? "on" : "failed");
    } catch {
      setState("failed");
    }
  }

  if (state === "unknown") return null;
  if (state === "on") return <p className="help">{t.active}</p>;
  if (state === "unsupported") return <p className="help">{t.unsupported}</p>;
  if (state === "blocked") return <p className="help">{t.blocked}</p>;
  return (
    <p className="actions">
      <button type="button" onClick={() => void turnOn()}>
        {t.on}
      </button>
      {state === "failed" ? <span role="alert"> {t.failed}</span> : null}
    </p>
  );
}
