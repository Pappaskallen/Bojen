"use client";

import { crm } from "@bojen/core/i18n/sv";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { PRF_SALT, codeStore, keyFromPrf, open, seal, type Codes } from "./codes-store";

const t = crm.day.lock;

/** How long the codes stay on the screen (spec 10.4). */
export const SHOW_SECONDS = 60;
/** The day view locks again after this long in the background. */
const RELOCK_MS = 5 * 60_000;

export interface PasskeyRef {
  id: string;
  prf: boolean;
}

interface Lock {
  locked: boolean;
  /** The key for the stored codes, while unlocked with a PRF passkey. */
  key: CryptoKey | null;
  hasPasskey: boolean;
  unlock: () => Promise<void>;
}

const LockContext = createContext<Lock>({
  locked: false,
  key: null,
  hasPasskey: false,
  unlock: () => Promise.resolve(),
});

const fromBase64url = (s: string) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

/**
 * The day view's lock (byggplan step 5.5c, spec 10.7): with a passkey, the day view opens
 * locked and is unlocked with Face ID, the fingerprint or the phone's PIN, and locks again
 * after five minutes in the background. Unlocking also gives the key for the codes on the
 * phone, when the passkey has PRF. Without a passkey there is no lock, and codes are only shown
 * with coverage.
 */
export function DayLock({ passkeys, children }: { passkeys: PasskeyRef[]; children: ReactNode }) {
  const hasPasskey = passkeys.length > 0;
  const [locked, setLocked] = useState(hasPasskey);
  const [key, setKey] = useState<CryptoKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hiddenAt = useRef<number | null>(null);

  useEffect(() => {
    const visibility = () => {
      if (document.visibilityState === "hidden") hiddenAt.current = Date.now();
      else if (hiddenAt.current && Date.now() - hiddenAt.current > RELOCK_MS && hasPasskey) {
        setLocked(true);
        setKey(null);
      }
    };
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, [hasPasskey]);

  const unlock = useCallback(async () => {
    setError(null);
    try {
      const credential = (await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          allowCredentials: passkeys.map((p) => ({
            id: fromBase64url(p.id),
            type: "public-key" as const,
          })),
          userVerification: "required",
          timeout: 60_000,
          extensions: {
            prf: { eval: { first: PRF_SALT } },
          } as AuthenticationExtensionsClientInputs,
        },
      })) as PublicKeyCredential | null;
      if (!credential) throw new Error("no credential");
      const results = credential.getClientExtensionResults() as {
        prf?: { results?: { first?: ArrayBuffer } };
      };
      const first = results.prf?.results?.first;
      setKey(first ? await keyFromPrf(first) : null);
      setLocked(false);
    } catch {
      setError(t.failed);
    }
  }, [passkeys]);

  return (
    <LockContext.Provider value={{ locked, key, hasPasskey, unlock }}>
      {locked ? (
        <div className="day-lock" role="dialog" aria-labelledby="lock-title">
          <h2 id="lock-title">{t.title}</h2>
          <p>{t.intro}</p>
          <button type="button" onClick={() => void unlock()}>
            {t.unlock}
          </button>
          {error ? (
            <p role="alert" className="error">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        children
      )}
      {!hasPasskey ? <p className="help">{t.noPasskey}</p> : null}
    </LockContext.Provider>
  );
}

type Shown = { codes: Codes; left: number };

/**
 * A visit's codes on the card (step 5.5c). With the key from the passkey they are fetched as
 * soon as the access rule allows (12 hours before the start) and kept encrypted on the phone;
 * they are shown only on request, for 60 seconds, and deleted when the job is done. Without
 * PRF they are fetched and shown with coverage only, after the unlock.
 */
export function VisitCodes({ visitId, done }: { visitId: string; done: boolean }) {
  const { key, locked, hasPasskey } = useContext(LockContext);
  const [stored, setStored] = useState(false);
  const [shown, setShown] = useState<Shown | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Done: the codes leave the phone.
  useEffect(() => {
    if (done) void codeStore.remove(visitId).then(() => setStored(false));
  }, [done, visitId]);

  // Download and seal while unlocked with a key, when the rule allows.
  useEffect(() => {
    if (!key || done) return;
    let stop = false;
    void (async () => {
      await codeStore.purge(Date.now()).catch(() => []);
      if (await codeStore.get(visitId).catch(() => undefined)) {
        if (!stop) setStored(true);
        return;
      }
      if (!navigator.onLine) return;
      const response = await fetch(`/api/idag/${visitId}/koder`, { method: "POST" }).catch(
        () => null,
      );
      if (!response?.ok) return;
      const body = (await response.json()) as Codes & { deleteBy: string };
      const sealed = await seal(key, visitId, {
        code: body.code,
        keyLocation: body.keyLocation,
        gateCode: body.gateCode,
        keyBox: body.keyBox,
      });
      await codeStore.put({ visitId, ...sealed, deleteBy: new Date(body.deleteBy).getTime() });
      if (!stop) setStored(true);
    })();
    return () => {
      stop = true;
    };
  }, [key, visitId, done]);

  // The 60 seconds.
  // One timer hides the codes; the other only counts down the seconds on the screen.
  const showing = shown !== null;
  useEffect(() => {
    if (!showing) return;
    const hide = setTimeout(() => setShown(null), SHOW_SECONDS * 1000);
    const tick = setInterval(
      () => setShown((s) => (s ? { ...s, left: Math.max(0, s.left - 1) } : s)),
      1000,
    );
    return () => {
      clearTimeout(hide);
      clearInterval(tick);
    };
  }, [showing]);

  if (done || !hasPasskey) return null;

  async function show() {
    setMessage(null);
    if (locked) return;
    try {
      if (key) {
        const item = await codeStore.get(visitId);
        if (!item) {
          setMessage(t.notYet);
          return;
        }
        setShown({ codes: await open(key, item), left: SHOW_SECONDS });
        return;
      }
      // A passkey without PRF: with coverage only, never kept.
      const response = await fetch(`/api/idag/${visitId}/koder`, { method: "POST" });
      if (!response.ok) {
        setMessage(response.status === 403 ? t.notYet : t.offlineOnly);
        return;
      }
      setShown({ codes: (await response.json()) as Codes, left: SHOW_SECONDS });
    } catch {
      setMessage(t.offlineOnly);
    }
  }

  const row = (label: string, value: string | null) =>
    value ? (
      <>
        <dt>{label}</dt>
        <dd className="secret">{value}</dd>
      </>
    ) : null;

  return (
    <div className="visit-codes" aria-label={t.codes}>
      {shown ? (
        <div className="access-shown">
          <dl className="summary">
            {row(crm.boat.code, shown.codes.code)}
            {row(crm.boat.keyLocation, shown.codes.keyLocation)}
            {row(crm.boat.gateCode, shown.codes.gateCode)}
            {row(crm.boat.keyBox, shown.codes.keyBox)}
          </dl>
          <p className="help" aria-live="polite">
            {crm.boat.hidesIn(shown.left)}
          </p>
          <button type="button" className="secondary" onClick={() => setShown(null)}>
            {crm.boat.hide}
          </button>
        </div>
      ) : (
        <button type="button" className="secondary" onClick={() => void show()}>
          {t.show}
        </button>
      )}
      <p className="help">{stored ? t.stored : key ? t.notStored : t.onlineOnly}</p>
      {message ? <p className="help">{message}</p> : null}
    </div>
  );
}
