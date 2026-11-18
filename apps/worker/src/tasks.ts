import type {
  CallSummarizer,
  EmailSender,
  MapsProvider,
  NameplateReader,
  ObjectStorage,
  PushSender,
  SmsSender,
  Transcriber,
} from "@bojen/core";
import {
  ALERT_TASK,
  FOLLOW_UP_TASK,
  NAMEPLATE_TASK,
  REFRESH_KPIS_TASK,
  SNAPSHOT_KPIS_TASK,
  POST_CALL_TASK,
  REPORT_TASK,
  SEND_MESSAGE_TASK,
  VOICEMAIL_TASK,
  readNameplate,
  refreshKpiViews,
  snapshotKpis,
  runFollowUp,
  runVoicemail,
  sendAlert,
  runPostCall,
  writeReportDraft,
  type DraftDeps,
} from "@bojen/db";
import { safeError } from "@bojen/core/logging";
import type { Task, TaskList } from "graphile-worker";
import { CHECK_TASK, sendAvailabilityCheck } from "./flows/availabilityCheck";
import { ESCALATION_TASK, REMINDER_TASK, handleCheckEvent } from "./flows/availabilityFollowup";
import type { FlowDeps } from "./flows/deps";
import { DOMAIN_EVENT_TASK, handleDomainEvent } from "./flows/events";
import { ETA_TASK, sendMorningEta } from "./flows/morningEta";
import { WAITLIST_TASK, sendWaitlistRound } from "./flows/waitlistOffer";
import { SURVEY_TASK, sendSurvey } from "./flows/survey";
import { sendMessageTask } from "./tasks/sendMessage";
import {
  CAMPAIGN_RELEASE_TASK,
  CAMPAIGN_ROUND_TASK,
  releaseCampaignHold,
  sendCampaignRound,
} from "./flows/campaign";

export interface WorkerDeps extends FlowDeps {
  sms: SmsSender;
  email: EmailSender;
  /** The report draft (step 5.5d): storage for the voice notes, the writer, speech to text. */
  reports?: Pick<DraftDeps, "storage" | "writer" | "transcriber">;
  /** Travel times for the times the spring campaign holds (step 5.6). */
  maps?: MapsProvider;
  /** After a call and for pictures of type plates (step 6.3). */
  postCall?: { summarizer: CallSummarizer; reader: NameplateReader; storage: ObjectStorage };
  /** Alerts to staff, the follow-up and the voicemail (step 6.4). */
  escalation?: EscalationDeps;
}

export interface EscalationDeps {
  push: PushSender;
  recordings: { fetch(wav: string): Promise<{ bytes: Uint8Array; contentType: string }> };
  /** Null until Azure Speech is set up (step 6.2b). */
  transcriber: Transcriber | null;
  /** The app, for the links to staff and the booking page: `https://bojen.se`. */
  appBase: string;
}

const list = (payload: unknown, name: string) => field(payload, name).split(",").filter(Boolean);

function field(payload: unknown, name: string): string {
  const value = (payload as Record<string, unknown> | null)?.[name];
  if (typeof value !== "string") throw new Error(`The job needs { ${name} }`);
  return value;
}

/** A task about one visit: { tenantId, visitId }. */
const visitTask =
  (run: (tenantId: string, visitId: string) => Promise<string>): Task =>
  async (payload, helpers) => {
    const result = await run(field(payload, "tenantId"), field(payload, "visitId"));
    helpers.logger.info(`visit ${field(payload, "visitId")}: ${result}`);
  };

/** Every background task, by its Graphile Worker name. */
export function taskList(deps: WorkerDeps): TaskList {
  return {
    [SEND_MESSAGE_TASK]: sendMessageTask(deps),
    [DOMAIN_EVENT_TASK]: async (payload, helpers) => {
      const eventId = field(payload, "eventId");
      helpers.logger.info(`event ${eventId}: ${await handleDomainEvent(deps, eventId)}`);
    },
    [CHECK_TASK]: visitTask((tenantId, visitId) => sendAvailabilityCheck(deps, tenantId, visitId)),
    [REMINDER_TASK]: visitTask((tenantId, visitId) =>
      handleCheckEvent(deps, tenantId, visitId, "reminder_due", `reminder:${visitId}`),
    ),
    [ESCALATION_TASK]: visitTask((tenantId, visitId) =>
      handleCheckEvent(deps, tenantId, visitId, "escalation_due", `escalation:${visitId}`),
    ),
    [WAITLIST_TASK]: async (payload, helpers) => {
      const visitId = field(payload, "visitId");
      const round = Number(field(payload, "round"));
      const outcome = await sendWaitlistRound(deps, field(payload, "tenantId"), visitId, round);
      helpers.logger.info(`waitlist ${visitId} round ${String(round)}: ${outcome}`);
    },
    [ETA_TASK]: visitTask((tenantId, visitId) => sendMorningEta(deps, tenantId, visitId)),
    [SURVEY_TASK]: visitTask((tenantId, visitId) => sendSurvey(deps, tenantId, visitId)),
    // The dashboard (step 7.1), from the crontab in index.ts.
    [REFRESH_KPIS_TASK]: async () => {
      await refreshKpiViews(deps.db);
    },
    [SNAPSHOT_KPIS_TASK]: async (_payload, helpers) => {
      helpers.logger.info(`kpi snapshots: ${String(await snapshotKpis(deps.db, deps.now()))}`);
    },
    [CAMPAIGN_RELEASE_TASK]: async (payload, helpers) => {
      const recipientId = field(payload, "recipientId");
      const outcome = await releaseCampaignHold(deps, field(payload, "tenantId"), recipientId);
      helpers.logger.info(`campaign recipient ${recipientId}: ${outcome}`);
    },
    ...(deps.maps
      ? {
          [CAMPAIGN_ROUND_TASK]: async (payload, helpers) => {
            const campaignId = field(payload, "campaignId");
            const maps = deps.maps;
            if (!maps) return;
            const outcome = await sendCampaignRound(
              { ...deps, maps },
              field(payload, "tenantId"),
              campaignId,
            );
            helpers.logger.info(`campaign ${campaignId}: ${outcome}`);
          },
        }
      : {}),
    ...(deps.postCall ? postCallTasks({ db: deps.db, ...deps.postCall }) : {}),
    ...(deps.escalation ? escalationTasks(deps, deps.escalation) : {}),
    ...(deps.reports ? reportTasks({ db: deps.db, now: deps.now, ...deps.reports }) : {}),
  };
}

/**
 * The report draft (step 5.5d), on its own so the end-to-end tests can run just this task:
 * there the worker must not send the demo data's sms.
 */
export function reportTasks(deps: DraftDeps): TaskList {
  return {
    [REPORT_TASK]: visitTask((tenantId, visitId) => writeReportDraft(deps, tenantId, visitId)),
  };
}

/** The work after a call, and reading pictures for type plates (step 6.3). */
export function postCallTasks(deps: {
  db: FlowDeps["db"];
  summarizer: CallSummarizer;
  reader: NameplateReader;
  storage: ObjectStorage;
}): TaskList {
  return {
    [POST_CALL_TASK]: async (payload, helpers) => {
      const callId = field(payload, "callId");
      const outcome = await runPostCall(deps, field(payload, "tenantId"), callId);
      helpers.logger.info(`call ${callId}: ${outcome}`);
    },
    [NAMEPLATE_TASK]: async (payload, helpers) => {
      const attachmentId = field(payload, "attachmentId");
      const outcome = await readNameplate(deps, field(payload, "tenantId"), attachmentId);
      helpers.logger.info(`picture ${attachmentId}: ${outcome}`);
    },
  };
}

/** The receptionist's rules for reaching a person (step 6.4). */
export function escalationTasks(
  deps: Pick<WorkerDeps, "db" | "now" | "optOutKey" | "sms">,
  e: EscalationDeps,
): TaskList {
  return {
    [ALERT_TASK]: async (payload, helpers) => {
      const taskId = field(payload, "taskId");
      const sent = await sendAlert(
        { db: deps.db, push: e.push, sms: deps.sms, now: deps.now, appBase: e.appBase },
        {
          tenantId: field(payload, "tenantId"),
          taskId,
          userIds: list(payload, "users"),
          channels: list(payload, "channels"),
        },
      );
      helpers.logger.info(
        `alert for task ${taskId}: ${String(sent.pushed)} push, ${String(sent.texted)} sms`,
      );
    },
    [FOLLOW_UP_TASK]: async (payload, helpers) => {
      const taskId = field(payload, "taskId");
      const next = await runFollowUp(
        { db: deps.db, now: deps.now, optOutKey: deps.optOutKey, appBase: e.appBase },
        { tenantId: field(payload, "tenantId"), taskId, alerted: list(payload, "alerted") },
      );
      helpers.logger.info(`follow-up of task ${taskId}: ${next.do}`);
    },
    [VOICEMAIL_TASK]: async (payload, helpers) => {
      const callId = field(payload, "callId");
      const made = await runVoicemail(
        {
          db: deps.db,
          now: deps.now,
          optOutKey: deps.optOutKey,
          recordings: e.recordings,
          transcriber: e.transcriber,
        },
        { tenantId: field(payload, "tenantId"), callId, wav: field(payload, "wav") },
      );
      helpers.logger.info(`voicemail ${callId}: ${made ? "message" : "no call"}`);
    },
  };
}

/**
 * Every task, with what a failure says made safe (ASVS V7.1): Graphile Worker logs a failed
 * job's error and keeps its message in `last_error`, and a database error's message carries
 * the query's parameters. The retry still happens; only the message changes.
 */
export function withSafeErrors(tasks: TaskList): TaskList {
  const safe: TaskList = {};
  for (const [name, task] of Object.entries(tasks)) {
    if (!task) continue;
    safe[name] = async (payload, helpers) => {
      try {
        await task(payload, helpers);
      } catch (error) {
        throw new Error(safeError(error));
      }
    };
  }
  return safe;
}
