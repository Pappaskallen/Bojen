import { describe, expect, it } from "vitest";
import { errorEvent, stackFrames } from "./errorEvent";

const options = {
  service: "worker",
  environment: "production",
  release: "0aca8d8",
  now: new Date("2026-11-22T10:00:00Z"),
  eventId: "0123456789abcdef0123456789abcdef",
};

describe("errorEvent", () => {
  it("keeps a failed query's parameters out of the report", () => {
    const failing = Object.assign(
      new Error(
        'Failed query: insert into "customer" values ($1)\nparams: Kim Kundsson,+46701740680',
      ),
      {
        name: "DrizzleQueryError",
        query: 'insert into "customer" values ($1)',
        cause: { code: "23505", constraint_name: "customer_phone_key" },
      },
    );
    const event = errorEvent(failing, { ...options, tags: { task: "send_message" } });
    const json = JSON.stringify(event);
    expect(json).not.toContain("Kundsson");
    expect(json).not.toContain("+4670");
    expect(event.exception.values[0]).toMatchObject({
      type: "DrizzleQueryError",
      value: 'insert into "customer" (pg 23505, constraint customer_phone_key)',
    });
    expect(event).toMatchObject({
      event_id: options.eventId,
      timestamp: 1795341600,
      platform: "node",
      level: "error",
      logger: "worker",
      release: "0aca8d8",
      environment: "production",
      tags: { service: "worker", task: "send_message" },
    });
  });

  it("scrubs numbers and addresses from messages and tags", () => {
    const event = errorEvent(new Error("no answer from +46701740680 or kim@firma.se"), {
      ...options,
      tags: { route: "/kund/kim@firma.se", empty: undefined },
    });
    expect(event.exception.values[0]?.value).toBe("no answer from [nummer] or [e-post]");
    expect(event.tags).toEqual({ service: "worker", route: "/kund/[e-post]" });
  });

  it("takes the stack's frames, not its first line, oldest call first", () => {
    const error = new Error("Kod 4711 till +46701740680");
    error.stack = [
      "Error: Kod 4711 till +46701740680",
      "    at sendMessage (file:///app/apps/worker/src/tasks/sendMessage.ts:42:11)",
      "    at async Object.send_message (/app/apps/worker/src/tasks.ts:238:9)",
      "    at /app/node_modules/graphile-worker/dist/worker.js:200:5",
      "    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)",
    ].join("\n");
    const event = errorEvent(error, options);
    expect(JSON.stringify(event)).not.toContain("4711");
    expect(event.exception.values[0]?.stacktrace?.frames).toEqual([
      {
        function: "process.processTicksAndRejections",
        filename: "node:internal/process/task_queues",
        lineno: 105,
        colno: 5,
        in_app: false,
      },
      {
        filename: "/app/node_modules/graphile-worker/dist/worker.js",
        lineno: 200,
        colno: 5,
        in_app: false,
      },
      {
        function: "Object.send_message",
        filename: "/app/apps/worker/src/tasks.ts",
        lineno: 238,
        colno: 9,
        in_app: true,
      },
      {
        function: "sendMessage",
        filename: "/app/apps/worker/src/tasks/sendMessage.ts",
        lineno: 42,
        colno: 11,
        in_app: true,
      },
    ]);
  });

  it("handles what is not an error", () => {
    expect(errorEvent("nope", options).exception.values).toEqual([{ type: "nope", value: "" }]);
    expect(errorEvent(null, { ...options, level: "fatal" })).toMatchObject({
      level: "fatal",
      exception: { values: [{ type: "unknown error", value: "" }] },
    });
    expect(stackFrames(undefined)).toEqual([]);
  });
});
