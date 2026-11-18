import {
  createClaudeNameplateReader,
  createClaudeReportWriter,
  createClaudeSummarizer,
  createFakeNameplateReader,
  createFakeSummarizer,
  createFakeReportWriter,
  createFakeStorage,
  createFakeTranscriber,
  createSupabaseStorage,
} from "@bojen/adapters";
import type {
  CallSummarizer,
  NameplateReader,
  ObjectStorage,
  ReportWriter,
  Transcriber,
} from "@bojen/core";

/**
 * What the report draft needs (step 5.5d), from the environment. In production Claude and
 * Supabase Storage must be configured. Speech to text has no account yet (Azure comes later,
 * agreed with Robert 2026-11-13): in production the voice notes then wait unread and the
 * draft is written without them; in development a fake writes them out.
 */
export function reportDeps(
  production: boolean,
  env: NodeJS.ProcessEnv = process.env,
): { storage: ObjectStorage; writer: ReportWriter; transcriber: Transcriber | null } {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  let storage: ObjectStorage;
  if (url && key)
    storage = createSupabaseStorage({ url, serviceRoleKey: key, bucket: "attachments" });
  else if (production) throw new Error("Supabase Storage is not configured");
  else storage = createFakeStorage();

  let writer: ReportWriter;
  if (env.ANTHROPIC_API_KEY) writer = createClaudeReportWriter();
  else if (production) throw new Error("ANTHROPIC_API_KEY is not set, so no report drafts");
  else writer = createFakeReportWriter();

  return { storage, writer, transcriber: production ? null : createFakeTranscriber() };
}

/**
 * What the work after a call needs (step 6.3): Claude Sonnet 5.5 for the summary and the
 * type plates, and the pictures' storage. In production Claude must be configured.
 */
export function postCallDeps(
  production: boolean,
  storage: ObjectStorage,
  env: NodeJS.ProcessEnv = process.env,
): { summarizer: CallSummarizer; reader: NameplateReader; storage: ObjectStorage } {
  if (env.ANTHROPIC_API_KEY) {
    return { summarizer: createClaudeSummarizer(), reader: createClaudeNameplateReader(), storage };
  }
  if (production) throw new Error("ANTHROPIC_API_KEY is not set, so no call summaries");
  return { summarizer: createFakeSummarizer(), reader: createFakeNameplateReader(), storage };
}
