import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The integration tests share one Postgres and Graphile's job table; one file at a time.
    fileParallelism: false,
  },
});
