/**
 * Putting the call through to the mechanic with a whisper (byggplan step 6.4, spec 8.4 K2):
 * the tool API says whom to ring and what to say; the agent rings them one at a time, each
 * for the firm's time limit (20 s), says who is calling and why, and lets the caller in when
 * the mechanic accepts. The mechanics' numbers stay here: the model only hears whether it
 * worked.
 */
import type { CallDialer } from "@bojen/core";

export const TRANSFER_TOOL = "koppla_till_mekaniker";

/** What `koppla_till_mekaniker` gives the agent when the call can be put through. */
export interface TransferOrder {
  mal: { id: string; nummer: string; namn: string }[];
  sekunder: number;
  viskning: string;
}

/** What the model hears. */
export type TransferAnswer = { status: "kopplad"; till: string } | { status: "ej_svar" };

export function transferOrder(answer: unknown): TransferOrder | null {
  if (typeof answer !== "object" || answer === null) return null;
  const a = answer as { status?: unknown; koppling?: unknown };
  if (a.status !== "kopplar" || typeof a.koppling !== "object" || a.koppling === null) return null;
  const k = a.koppling as Partial<TransferOrder>;
  if (!Array.isArray(k.mal) || typeof k.sekunder !== "number" || typeof k.viskning !== "string") {
    return null;
  }
  const mal = k.mal.filter(
    (m): m is TransferOrder["mal"][number] =>
      typeof m === "object" &&
      m !== null &&
      typeof m.id === "string" &&
      typeof m.nummer === "string" &&
      /^\+\d{7,15}$/.test(m.nummer) &&
      typeof m.namn === "string",
  );
  return { mal, sekunder: k.sekunder, viskning: k.viskning };
}

/**
 * Rings the mechanics in order; reports the outcome to the tool API (it marks the call put
 * through, or not) and answers the model. Without a dialer (no telephony yet) no one answers.
 */
export async function transferCall(input: {
  order: TransferOrder;
  dialer: CallDialer | null;
  report: (result: { besvarad: boolean; mal_id: string | null }) => Promise<unknown>;
  signal?: AbortSignal;
}): Promise<TransferAnswer> {
  for (const target of input.dialer ? input.order.mal : []) {
    if (input.signal?.aborted) break;
    const result = await input.dialer?.dial({
      number: target.nummer,
      whisper: input.order.viskning,
      timeoutSeconds: input.order.sekunder,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (result === "answered") {
      await input.report({ besvarad: true, mal_id: target.id });
      return { status: "kopplad", till: target.namn };
    }
  }
  await input.report({ besvarad: false, mal_id: null });
  return { status: "ej_svar" };
}
