/**
 * Fixed keys for the end-to-end tests only, shared by the web server (playwright.config.ts)
 * and the specs. Not secrets: they only ever meet the local database.
 */
export const E2E_SHORT_LINK_KEY = "e2e-only-short-link-key-long-enough-1234";
/** 32 bytes, base64. */
export const E2E_LOCAL_KMS_MASTER_KEY = "ZTJlLW9ubHkta21zLW1hc3Rlci1rZXktMzItYnl0ZXM=";

/** The local Supabase: the fixed demo keys every `supabase start` prints, not secrets. */
export const LOCAL_SUPABASE_URL = "http://127.0.0.1:54321";
export const LOCAL_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
export const LOCAL_SUPABASE_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

/** What the fake speech to text makes of every voice note in the tests (step 5.5d). */
export const E2E_TRANSCRIPT = "Impellern hade två skadade vingar.";
