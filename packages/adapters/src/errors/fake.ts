import type { ErrorReporter } from "@bojen/core/logging";

export interface FakeErrorReporter extends ErrorReporter {
  readonly reported: { error: unknown; tags: Record<string, string | undefined> }[];
}

/** Error reports for tests: kept in a list, nothing leaves the machine. */
export function createFakeErrorReporter(): FakeErrorReporter {
  const reported: FakeErrorReporter["reported"] = [];
  return {
    reported,
    report(error, context = {}) {
      reported.push({ error, tags: context.tags ?? {} });
      return Promise.resolve();
    },
  };
}
