import type { Instrumentation } from "next";
import { errorReporter, reportRequestError } from "./lib/errors";

/** Errors that no route caught, to GlitchTip (byggplan step 9); see lib/errors.ts. */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) =>
  reportRequestError(errorReporter(), error, request, context);
