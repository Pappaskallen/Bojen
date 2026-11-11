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
      // No real services: fake sms, maps, address search and storage.
      OSRM_URL: "",
      PHOTON_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      BOJEN_FAKE_SERVICES: "1",
      BOOKING_SESSION_SECRET: "e2e-only-secret-that-is-long-enough-1234",
    },
  },
});
