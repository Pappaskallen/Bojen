import type { ObjectStorage } from "@bojen/core";

export interface SupabaseStorageOptions {
  /** `NEXT_PUBLIC_SUPABASE_URL`, for example `http://127.0.0.1:54321`. */
  url: string;
  /** `SUPABASE_SERVICE_ROLE_KEY`. Server only; never sent to the browser. */
  serviceRoleKey: string;
  /** Private bucket. Created on first upload. */
  bucket: string;
  fetch?: typeof globalThis.fetch;
}

/**
 * Supabase Storage over its REST API. The bucket is private; files are read later through
 * signed links. Keys start with the tenant id (see `attachment`).
 */
export function createSupabaseStorage(options: SupabaseStorageOptions): ObjectStorage {
  const send = options.fetch ?? globalThis.fetch;
  const base = `${options.url.replace(/\/+$/, "")}/storage/v1`;
  const auth = {
    Authorization: `Bearer ${options.serviceRoleKey}`,
    apikey: options.serviceRoleKey,
  };
  let bucketReady: Promise<void> | undefined;

  async function ensureBucket() {
    const response = await send(`${base}/bucket`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ id: options.bucket, name: options.bucket, public: false }),
    });
    // 409 (or 400 "already exists" on older versions) means the bucket is there.
    if (response.ok || response.status === 409) return;
    const text = await response.text();
    if (response.status === 400 && /exist/i.test(text)) return;
    throw new Error(`Supabase Storage could not create the bucket: ${String(response.status)}`);
  }

  return {
    async put(key, body, contentType) {
      bucketReady ??= ensureBucket().catch((error: unknown) => {
        bucketReady = undefined;
        throw error;
      });
      await bucketReady;
      const path = key.split("/").map(encodeURIComponent).join("/");
      const response = await send(`${base}/object/${options.bucket}/${path}`, {
        method: "POST",
        headers: { ...auth, "Content-Type": contentType, "x-upsert": "false" },
        body: new Blob([body as Uint8Array<ArrayBuffer>], { type: contentType }),
      });
      if (!response.ok) {
        throw new Error(`Supabase Storage refused the upload: ${String(response.status)}`);
      }
    },
  };
}
