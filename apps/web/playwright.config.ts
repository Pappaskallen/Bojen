import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

/**
 * End-to-end tests of the booking page (byggplan step 2.5). They run against a production
 * build, because Lighthouse measures that, and against the local database, which the global
 * setup empties and fills with the demo data. Never point this at anything but localhost.
 */
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    locale: "sv-SE",
    timezoneId: "Europe/Stockholm",
    trace: "retain-on-failure",
  },
  projects: [{ name: "mobile", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: `pnpm exec next build && pnpm exec next start -p ${String(PORT)}`,
    // The home page: the booking page needs the demo data, which the global setup loads later.
    url: `http://127.0.0.1:${String(PORT)}/`,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    env: {
      // Fake sms, maps and address search. Auth and Storage are the local Supabase; these
      // are the fixed demo keys that every `supabase start` prints, not secrets.
      OSRM_URL: "",
      PHOTON_URL: "",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY:
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0",
      SUPABASE_SERVICE_ROLE_KEY:
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
      BOJEN_FAKE_SERVICES: "1",
      BOOKING_SESSION_SECRET: "e2e-only-secret-that-is-long-enough-1234",
    },
  },
});
