import type { EmailSender, SmsSender } from "@bojen/core";
import { SEND_MESSAGE_TASK } from "@bojen/db";
import type { Task, TaskList } from "graphile-worker";
import { CHECK_TASK, sendAvailabilityCheck } from "./flows/availabilityCheck";
import type { FlowDeps } from "./flows/deps";
import { DOMAIN_EVENT_TASK, handleDomainEvent } from "./flows/events";
import { ETA_TASK, sendMorningEta } from "./flows/morningEta";
import { SURVEY_TASK, sendSurvey } from "./flows/survey";
import { sendMessageTask } from "./tasks/sendMessage";

export interface WorkerDeps extends FlowDeps {
  sms: SmsSender;
  email: EmailSender;
}

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
    [ETA_TASK]: visitTask((tenantId, visitId) => sendMorningEta(deps, tenantId, visitId)),
    [SURVEY_TASK]: visitTask((tenantId, visitId) => sendSurvey(deps, tenantId, visitId)),
  };
}
