import { describe, expect, it } from "vitest";
import { fieldsOf, flushQueue, formDataOf, type QueueStore, type QueuedForm } from "./queue";

function memory(items: QueuedForm[]): QueueStore & { items: QueuedForm[] } {
  const store = {
    items: [...items],
    all: () => Promise.resolve([...store.items]),
    put: (item: QueuedForm) => {
      store.items.push(item);
      return Promise.resolve();
    },
    remove: (id: string) => {
      store.items = store.items.filter((i) => i.id !== id);
      return Promise.resolve();
    },
  };
  return store;
}

const form = (id: string, createdAt: number, label = id): QueuedForm => ({
  id,
  url: `/api/idag/v/${id}`,
  fields: [["key", id]],
  createdAt,
  label,
});

describe("the offline queue", () => {
  it("sends everything in the order it was made, and empties the queue", async () => {
    const store = memory([form("b", 2), form("a", 1), form("c", 3)]);
    const order: string[] = [];
    const r = await flushQueue(store, (item) => {
      order.push(item.id);
      return Promise.resolve({ status: 200 });
    });
    expect(order).toEqual(["a", "b", "c"]);
    expect(r).toEqual({ sent: 3, left: 0, refused: [], signInNeeded: false, stopped: false });
    expect(store.items).toEqual([]);
  });

  it("stops at the first network failure and keeps the rest for later", async () => {
    const store = memory([form("a", 1), form("b", 2), form("c", 3)]);
    let n = 0;
    const r = await flushQueue(store, () => {
      n += 1;
      return n === 2
        ? Promise.reject(new TypeError("Failed to fetch"))
        : Promise.resolve({ status: 200 });
    });
    expect(r).toMatchObject({ sent: 1, left: 2, stopped: true });
    expect(store.items.map((i) => i.id)).toEqual(["b", "c"]);
  });

  it("keeps the rest when the server cannot answer now", async () => {
    const store = memory([form("a", 1), form("b", 2)]);
    const r = await flushQueue(store, () => Promise.resolve({ status: 503 }));
    expect(r).toMatchObject({ sent: 0, left: 2, stopped: true });
    expect(store.items).toHaveLength(2);
  });

  it("drops a form the server refuses for good, says so, and goes on", async () => {
    const store = memory([form("a", 1, "Klart: Per"), form("b", 2)]);
    const r = await flushQueue(store, (item) =>
      Promise.resolve(item.id === "a" ? { status: 422, problem: "wrong_state" } : { status: 200 }),
    );
    expect(r).toMatchObject({
      sent: 1,
      left: 0,
      refused: [{ label: "Klart: Per", problem: "wrong_state" }],
    });
    expect(store.items).toEqual([]);
  });

  it("waits for a new sign-in without losing anything", async () => {
    const store = memory([form("a", 1), form("b", 2)]);
    const r = await flushQueue(store, () => Promise.resolve({ status: 401 }));
    expect(r).toMatchObject({ sent: 0, left: 2, signInNeeded: true });
    expect(store.items).toHaveLength(2);
  });

  it("keeps a picture as it is between the form and the queue", async () => {
    const data = new FormData();
    data.set("key", "k1");
    data.set("photo", new File([new Uint8Array([1, 2, 3])], "bild.png", { type: "image/png" }));
    data.set("empty", new File([], "", { type: "application/octet-stream" }));
    const fields = fieldsOf(data);
    expect(fields.map(([name]) => name)).toEqual(["key", "photo"]);
    const back = formDataOf(fields);
    const photo = back.get("photo");
    expect(photo).toBeInstanceOf(File);
    expect((photo as File).type).toBe("image/png");
    expect(new Uint8Array(await (photo as File).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(back.get("key")).toBe("k1");
  });
});
