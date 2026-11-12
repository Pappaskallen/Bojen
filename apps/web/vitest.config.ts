import { defineConfig } from "vitest/config";

export default defineConfig({
  // The app uses jsx: "preserve" for Next.js; tests need the automatic runtime.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["app/**/*.test.ts", "lib/**/*.test.ts", "test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    fileParallelism: false,
  },
});
