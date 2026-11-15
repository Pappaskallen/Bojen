/**
 * The offline queue of the day view (byggplan step 5.5b): a form sent without coverage is kept
 * in IndexedDB on the phone and sent when the network is back, in the order it was made. Each
 * form carries its own key, so one that is sent twice is done once on the server.
 *
 * `flushQueue` is the logic and takes its store and sender as arguments, so it is tested
 * without a browser; `indexedDbStore` is the store on the phone.
 */

export type QueuedField = [
  name: string,
  value: string | { name: string; type: string; blob: Blob },
];

export interface QueuedForm {
  id: string;
  /** The form's action, `/api/idag/{visitId}/{action}`. */
  url: string;
  fields: QueuedField[];
  createdAt: number;
  /** What the mechanic sees in the list, for example "Klart: Per Persson". */
  label: string;
}

export interface QueueStore {
  all(): Promise<QueuedForm[]>;
  put(item: QueuedForm): Promise<void>;
  remove(id: string): Promise<void>;
}

/** What the server answered: 200 done, 401 sign in again, 4xx refused for good, 5xx later. */
export type Send = (item: QueuedForm) => Promise<{ status: number; problem?: string }>;

export interface FlushResult {
  sent: number;
  left: number;
  /** Refused for good, for example a visit that was already done; removed from the queue. */
  refused: { label: string; problem: string }[];
  /** The server wants a new sign-in; the rest waits. */
  signInNeeded: boolean;
  /** No coverage, or the server could not answer; the rest waits. */
  stopped: boolean;
}

export async function flushQueue(store: QueueStore, send: Send): Promise<FlushResult> {
  const items = (await store.all()).sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
  const result: FlushResult = {
    sent: 0,
    left: items.length,
    refused: [],
    signInNeeded: false,
    stopped: false,
  };
  for (const item of items) {
    let answer: { status: number; problem?: string };
    try {
      answer = await send(item);
    } catch {
      result.stopped = true;
      return result;
    }
    if (answer.status >= 200 && answer.status < 300) {
      await store.remove(item.id);
      result.sent += 1;
    } else if (answer.status === 401) {
      result.signInNeeded = true;
      return result;
    } else if (answer.status >= 400 && answer.status < 500) {
      await store.remove(item.id);
      result.refused.push({ label: item.label, problem: answer.problem ?? "failed" });
    } else {
      result.stopped = true;
      return result;
    }
    result.left -= 1;
  }
  return result;
}

/** The form's fields, with files kept as blobs (IndexedDB stores them as they are). */
export function fieldsOf(form: FormData): QueuedField[] {
  const out: QueuedField[] = [];
  form.forEach((value, name) => {
    if (typeof value === "string") out.push([name, value]);
    else if (value.size > 0) out.push([name, { name: value.name, type: value.type, blob: value }]);
  });
  return out;
}

export function formDataOf(fields: readonly QueuedField[]): FormData {
  const form = new FormData();
  for (const [name, value] of fields) {
    if (typeof value === "string") form.append(name, value);
    else form.append(name, new File([value.blob], value.name, { type: value.type }));
  }
  return form;
}

const DB = "bojen-offline";
const STORE = "forms";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB"));
  });
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>) {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(request.result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error("IndexedDB"));
        };
      }),
  );
}

/** The queue in the phone's IndexedDB. */
export const indexedDbStore: QueueStore = {
  all: () => run("readonly", (s) => s.getAll() as IDBRequest<QueuedForm[]>),
  put: async (item) => {
    await run("readwrite", (s) => s.put(item));
  },
  remove: async (id) => {
    await run("readwrite", (s) => s.delete(id));
  },
};
