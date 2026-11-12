import type { ObjectStorage } from "@bojen/core";

export interface FakeStorage extends ObjectStorage {
  readonly objects: Map<string, { body: Uint8Array; contentType: string }>;
}

/** Keeps files in memory. Refuses to overwrite, like the real bucket. */
export function createFakeStorage(): FakeStorage {
  const objects: FakeStorage["objects"] = new Map();
  return {
    objects,
    put(key, body, contentType) {
      if (objects.has(key)) return Promise.reject(new Error("The object already exists"));
      objects.set(key, { body, contentType });
      return Promise.resolve();
    },
  };
}
