import { defineConfig } from "vitest/config";

export default defineConfig({
  // The app uses jsx: "preserve" for Next.js; tests need the automatic runtime.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["app/**/*.test.ts", "lib/**/*.test.ts", "test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    fileParallelism: false,
    // The sign-in tests go through the local Supabase Auth; under the whole repo's test run
    // on a loaded laptop the default 5 s has failed tests that pass on their own.
    testTimeout: 20_000,
  },
});
