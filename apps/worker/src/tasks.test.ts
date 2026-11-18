import {
  createFakeEmail,
  createFakeNameplateReader,
  createFakePush,
  createFakeReportWriter,
  createFakeSms,
  createFakeStorage,
  createFakeSummarizer,
} from "@bojen/adapters";
import type { Database } from "@bojen/db";
import type { JobHelpers } from "graphile-worker";
import { describe, expect, it } from "vitest";
import { privacyTasks, reportTasks, taskList, withSafeErrors } from "./tasks";

describe("worker tasks", () => {
  const tasks = taskList({
    db: {} as Database,
    sms: createFakeSms(),
    now: () => new Date(),
    optOutKey: "k",
    email: createFakeEmail(),
    link: () => "bojen.se/boka/test",
  });

  it("has the tasks of steps 3.1, 3.3, 4.1, 4.2, 4.3, 5.6 and 7.1", () => {
    expect(Object.keys(tasks).sort()).toEqual(
      [
        "campaign_release",
        "domain_event",
        "refresh_kpis",
        "send_message",
        "snapshot_kpis",
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

  it("has the alerts, follow-up and voicemail of step 6.4 when it has push", () => {
    const all = taskList({
      db: {} as Database,
      sms: createFakeSms(),
      now: () => new Date(),
      optOutKey: "k",
      email: createFakeEmail(),
      link: () => "bojen.se/boka/test",
      escalation: {
        push: createFakePush(),
        recordings: { fetch: () => Promise.reject(new Error("not used")) },
        transcriber: null,
        appBase: "https://bojen.se",
      },
    });
    expect(Object.keys(all)).toEqual(
      expect.arrayContaining(["alert_staff", "escalation_follow_up", "voicemail"]),
    );
  });

  it("refuses a payload without a message id", async () => {
    await expect(tasks.send_message?.({}, {} as JobHelpers)).rejects.toThrow("messageId");
  });
});

describe("withSafeErrors", () => {
  it("keeps a failed query's parameters out of the job's error, and still fails the job", async () => {
    const failing = Object.assign(
      new Error('Failed query: update "visit" set "note" = $1\nparams: Kod 4711 till +46701740680'),
      {
        name: "DrizzleQueryError",
        query: 'update "visit" set "note" = $1',
        cause: { code: "23514" },
      },
    );
    const ok: string[] = [];
    const safe = withSafeErrors({
      fails: () => Promise.reject(failing),
      works: (payload) => {
        ok.push(String(payload));
        return Promise.resolve();
      },
    });
    const helpers = {} as JobHelpers;
    await expect(safe.fails?.({}, helpers)).rejects.toThrow(
      'DrizzleQueryError: update "visit" (pg 23514)',
    );
    await expect(safe.fails?.({}, helpers)).rejects.not.toThrow(/4711|\+4670/);
    await safe.works?.("x", helpers);
    expect(ok).toEqual(["x"]);
  });
});

describe("the nightly clean-up (step 7.4)", () => {
  it("is a task when the worker has storage, and runs at night from the crontab", async () => {
    const { PRIVACY_CRONTAB } = await import("@bojen/db");
    const storage = createFakeStorage();
    const tasks = taskList({
      db: {} as Database,
      sms: createFakeSms(),
      now: () => new Date(),
      optOutKey: "k",
      email: createFakeEmail(),
      link: () => "bojen.se/boka/test",
      privacy: { storage },
    });
    expect(Object.keys(tasks)).toContain("privacy_retention");
    expect(
      Object.keys(privacyTasks({ db: {} as Database, storage, now: () => new Date() })),
    ).toEqual(["privacy_retention"]);
    expect(PRIVACY_CRONTAB).toBe("0 2 * * * privacy_retention");
  });
});
