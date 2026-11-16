import {
  createFakeEmail,
  createFakeNameplateReader,
  createFakeReportWriter,
  createFakeSms,
  createFakeStorage,
  createFakeSummarizer,
} from "@bojen/adapters";
import type { Database } from "@bojen/db";
import type { JobHelpers } from "graphile-worker";
import { describe, expect, it } from "vitest";
import { reportTasks, taskList } from "./tasks";

describe("worker tasks", () => {
  const tasks = taskList({
    db: {} as Database,
    sms: createFakeSms(),
    now: () => new Date(),
    optOutKey: "k",
    email: createFakeEmail(),
    link: () => "bojen.se/boka/test",
  });

  it("has the tasks of steps 3.1, 3.3, 4.1, 4.2, 4.3 and 5.6", () => {
    expect(Object.keys(tasks).sort()).toEqual(
      [
        "campaign_release",
        "domain_event",
        "send_message",
        "visit_check",
        "visit_check_escalation",
        "visit_check_reminder",
        "visit_eta",
        "visit_survey",
        "waitlist_round",
      ].sort(),
    );
  });

  it("has the work after a call and the type plates of step 6.3 when it has the readers", () => {
    const all = taskList({
      db: {} as Database,
      sms: createFakeSms(),
      now: () => new Date(),
      optOutKey: "k",
      email: createFakeEmail(),
      link: () => "bojen.se/boka/test",
      postCall: {
        summarizer: createFakeSummarizer(),
        reader: createFakeNameplateReader(),
        storage: createFakeStorage(),
      },
    });
    expect(Object.keys(all)).toEqual(expect.arrayContaining(["post_call", "nameplate_read"]));
  });

  it("has the report draft of step 5.5d when it has a writer, also on its own", () => {
    const reports = {
      storage: createFakeStorage(),
      writer: createFakeReportWriter(),
      transcriber: null,
    };
    const all = taskList({
      db: {} as Database,
      sms: createFakeSms(),
      now: () => new Date(),
      optOutKey: "k",
      email: createFakeEmail(),
      link: () => "bojen.se/boka/test",
      reports,
    });
    expect(Object.keys(all)).toContain("report_draft");
    expect(
      Object.keys(reportTasks({ db: {} as Database, now: () => new Date(), ...reports })),
    ).toEqual(["report_draft"]);
  });

  it("refuses a payload without a message id", async () => {
    await expect(tasks.send_message?.({}, {} as JobHelpers)).rejects.toThrow("messageId");
  });
});
