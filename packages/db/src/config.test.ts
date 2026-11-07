import { describe, expect, it } from "vitest";
import { databaseUrl, localDatabaseUrl } from "./config";

describe("databaseUrl", () => {
  it("falls back to the local Supabase database", () => {
    expect(databaseUrl({})).toBe(localDatabaseUrl);
  });

  it("prefers DATABASE_URL", () => {
    expect(databaseUrl({ DATABASE_URL: "postgresql://x" })).toBe("postgresql://x");
  });
});
