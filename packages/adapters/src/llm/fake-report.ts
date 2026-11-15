import type { ReportFacts, ReportWriter, Transcriber } from "@bojen/core";

export interface FakeReportWriter extends ReportWriter {
  /** The facts it was given, in order. */
  readonly calls: ReportFacts[];
  /** Fails the next `n` drafts, as an API that does not answer. */
  failNext(n: number): void;
}

const sentences = (text: string | null) =>
  (text ?? "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim().replace(/[.!?]$/, ""))
    .filter(Boolean);

/**
 * A draft without a model, for tests and development: the service, the installed parts and
 * every sentence of the notes and voice notes become points. Never calls anything outside.
 */
export function createFakeReportWriter(): FakeReportWriter {
  const calls: ReportFacts[] = [];
  let failures = 0;
  return {
    name: "fake",
    calls,
    failNext(n) {
      failures = n;
    },
    draft(facts) {
      calls.push(facts);
      if (failures > 0) {
        failures--;
        return Promise.reject(new Error("The fake report writer is set to fail"));
      }
      const installed = facts.parts
        .filter((p) => p.status === "installed")
        .map((p) => `Monterat ${p.description.toLowerCase()}`);
      return Promise.resolve({
        workDone: [
          ...(facts.service ? [`Utfört: ${facts.service}`] : []),
          ...installed,
          ...sentences(facts.notes),
          ...facts.voiceNotes.flatMap(sentences),
        ],
        recommendations: [],
        nextService: null,
      });
    },
  };
}

export interface FakeTranscriber extends Transcriber {
  readonly calls: { bytes: Uint8Array; contentType: string }[];
}

/**
 * Speech to text without Azure: every recording becomes `text`. Until the Azure account
 * exists this is what development runs (byggplan step 5.5, agreed with Robert 2026-11-13).
 */
export function createFakeTranscriber(
  text = "Röstanteckning, utskriven av fejktjänsten.",
): FakeTranscriber {
  const calls: FakeTranscriber["calls"] = [];
  return {
    calls,
    transcribe(audio) {
      calls.push(audio);
      return Promise.resolve(text);
    },
  };
}
