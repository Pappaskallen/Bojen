/**
 * The codes kept on the phone (byggplan step 5.5c, spec 10.4, decided with Robert 2026-11-13).
 *
 * A PWA cannot reach the iOS Keychain or the Android Keystore. Instead the key comes from the
 * mechanic's passkey: the WebAuthn PRF extension gives 32 secret bytes, but only after Face
 * ID, the fingerprint or the phone's PIN. From those bytes HKDF makes an AES-GCM key that never
 * leaves memory and cannot be exported. What is stored in IndexedDB is ciphertext only; without
 * the passkey and the biometrics it cannot be read, not even with the browser's developer tools.
 *
 * Each visit's codes are deleted when the job is done, and at the latest when the server said:
 * 12 hours after the start, never more than 24 hours after the download.
 */

/** The fixed input to the passkey's PRF: the same passkey always gives the same key for it. */
export const PRF_SALT = new TextEncoder().encode("bojen/day-codes/v1/prf-salt-000000").slice(0, 32);

export interface Codes {
  code: string | null;
  keyLocation: string | null;
  gateCode: string | null;
  keyBox: string | null;
}

interface StoredCodes {
  visitId: string;
  iv: Uint8Array<ArrayBuffer>;
  data: ArrayBuffer;
  deleteBy: number;
}

/** The AES-GCM key from the passkey's PRF output. Not extractable. */
export async function keyFromPrf(prfOutput: ArrayBuffer): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", prfOutput, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode("bojen-day-codes"),
      info: new TextEncoder().encode("aes-gcm-256/v1"),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function seal(key: CryptoKey, visitId: string, codes: Codes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    // The visit is part of the sealed data, so one visit's codes cannot be passed off as another's.
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(visitId) },
    key,
    new TextEncoder().encode(JSON.stringify(codes)),
  );
  return { iv, data };
}

export async function open(key: CryptoKey, stored: Pick<StoredCodes, "visitId" | "iv" | "data">) {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: stored.iv, additionalData: new TextEncoder().encode(stored.visitId) },
    key,
    stored.data,
  );
  return JSON.parse(new TextDecoder().decode(plain)) as Codes;
}

const DB = "bojen-codes";
const STORE = "codes";

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "visitId" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB"));
  });
}

function run<T>(mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T>) {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        tx.oncomplete = () => {
          d.close();
          resolve(request.result);
        };
        tx.onerror = () => {
          d.close();
          reject(tx.error ?? new Error("IndexedDB"));
        };
      }),
  );
}

export const codeStore = {
  get: (visitId: string) =>
    run("readonly", (s) => s.get(visitId) as IDBRequest<StoredCodes | undefined>),
  put: async (item: StoredCodes) => {
    await run("readwrite", (s) => s.put(item));
  },
  remove: async (visitId: string) => {
    await run("readwrite", (s) => s.delete(visitId));
  },
  /** Deletes everything past its time; returns what is left. */
  purge: async (now: number) => {
    const all = await run("readonly", (s) => s.getAll() as IDBRequest<StoredCodes[]>);
    for (const item of all) if (item.deleteBy <= now) await codeStore.remove(item.visitId);
    return all.filter((i) => i.deleteBy > now).map((i) => i.visitId);
  },
};
