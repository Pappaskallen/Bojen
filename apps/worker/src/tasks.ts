/**
 * Background job handlers. Graphile Worker is wired in when the first task
 * (sendMessage, step 3.1) is built.
 */
export type TaskHandler = (payload: unknown) => Promise<void>;

export const tasks: Record<string, TaskHandler> = {};
