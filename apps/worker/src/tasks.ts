import { SEND_MESSAGE_TASK } from "@bojen/db";
import type { TaskList } from "graphile-worker";
import { sendMessageTask, type SendMessageDeps } from "./tasks/sendMessage";

/** Every background task, by its Graphile Worker name. */
export function taskList(deps: SendMessageDeps): TaskList {
  return {
    [SEND_MESSAGE_TASK]: sendMessageTask(deps),
  };
}
