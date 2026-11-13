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
    signedUrl(key, seconds) {
      if (!objects.has(key)) return Promise.reject(new Error("No such object"));
      // A data URL, so a page in development shows the picture without a storage server.
      const object = objects.get(key);
      void seconds;
      return Promise.resolve(
        `data:${object?.contentType ?? "application/octet-stream"};base64,${Buffer.from(object?.body ?? new Uint8Array()).toString("base64")}`,
      );
    },
  };
}
