import { createFakeEmail, createFakeSms } from "@bojen/adapters";
import type { Database } from "@bojen/db";
import type { JobHelpers } from "graphile-worker";
import { describe, expect, it } from "vitest";
import { taskList } from "./tasks";

describe("worker tasks", () => {
  const tasks = taskList({
    db: {} as Database,
    sms: createFakeSms(),
    now: () => new Date(),
    optOutKey: "k",
    email: createFakeEmail(),
    link: () => "bojen.se/boka/test",
  });

  it("has the tasks of steps 3.1 and 3.3", () => {
    expect(Object.keys(tasks).sort()).toEqual(
      ["domain_event", "send_message", "visit_eta", "visit_survey"].sort(),
    );
  });

  it("refuses a payload without a message id", async () => {
    await expect(tasks.send_message?.({}, {} as JobHelpers)).rejects.toThrow("messageId");
  });
});
