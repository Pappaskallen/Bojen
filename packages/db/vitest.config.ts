import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    // All database test files share one Postgres; run them one at a time.
    fileParallelism: false,
    // A test that sets up a firm, encrypts and queries takes a few seconds on a loaded laptop;
    // the default 5 s has failed tests that pass on their own.
    testTimeout: 20_000,
  },
});
