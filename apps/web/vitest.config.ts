import { defineConfig } from "vitest/config";

export default defineConfig({
  // The app uses jsx: "preserve" for Next.js; tests need the automatic runtime.
  oxc: { jsx: { runtime: "automatic" } },
});
