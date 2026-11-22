import { describe, expect, it } from "vitest";
import { safeError, scrubMessage } from "./safeError";

describe("safeError", () => {
  it("keeps a failed query's parameters out", () => {
    const pg = Object.assign(new Error('duplicate key value violates unique constraint "x"'), {
      name: "PostgresError",
      code: "23505",
      constraint_name: "customer_phone_key",
    });
    const drizzle = Object.assign(
      new Error(
        'Failed query: insert into "customer" ("name","phone") values ($1, $2)\nparams: Kedja Kundsson,+46701740680',
      ),
      {
        name: "DrizzleQueryError",
        query: 'insert into "customer" ("name","phone") values ($1, $2)',
        params: ["Kedja Kundsson", "+46701740680"],
        cause: pg,
      },
    );
    const line = safeError(drizzle);
    expect(line).toBe(
      'DrizzleQueryError: insert into "customer" (pg 23505, constraint customer_phone_key)',
    );
    expect(line).not.toContain("Kundsson");
    expect(line).not.toContain("+4670");
  });

  it("gives a Postgres error its code, not its message", () => {
    const pg = Object.assign(new Error('invalid input syntax for type uuid: "+46701740680"'), {
      name: "PostgresError",
      code: "22P02",
    });
    expect(safeError(pg)).toBe("PostgresError: pg 22P02");
  });

  it("scrubs numbers and addresses from other messages", () => {
    expect(safeError(new Error("46elks refused +46701740680 for kim@firma.se"))).toBe(
      "Error: 46elks refused [nummer] for [e-post]",
    );
    expect(scrubMessage("code 482913 sent")).toBe("code [nummer] sent");
    expect(scrubMessage("gate code 4711, try 404")).toBe("gate code [nummer], try 404");
    expect(scrubMessage("x".repeat(300))).toHaveLength(201);
    expect(safeError(new TypeError("visit not found"))).toBe("TypeError: visit not found");
    expect(safeError(null)).toBe("unknown error");
  });
});
