/**
 * Whether the voice agent answers (byggplan step 6.4, rule K10). The web app asks before it
 * tells 46elks where an incoming call goes; a slow or silent agent counts as down, so the
 * caller reaches the mechanic instead of waiting.
 */
export function createAgentHealth(options: {
  /** The agent's health address, for example `http://voice.internal:8081/health`. */
  url: string | null;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}): () => Promise<boolean> {
  const send = options.fetch ?? globalThis.fetch;
  return async () => {
    if (!options.url) return false;
    try {
      const response = await send(options.url, {
        signal: AbortSignal.timeout(options.timeoutMs ?? 1500),
        cache: "no-store",
      });
      return response.ok;
    } catch {
      return false;
    }
  };
}
