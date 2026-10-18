import type { Instrumentation } from "next";
import { reportServerError } from "@/lib/ops/report-error";

/**
 * Every error the server could not handle, from a page, a route handler or a
 * server action, reported in one place (lib/ops/report-error.ts): a findable
 * log line always, and a collector when one is configured.
 *
 * Awaited, as Next asks: the report is part of handling the error. It cannot
 * throw and gives up after two seconds, so it never costs a user more than
 * the failure already has.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  await reportServerError(error as Error & { digest?: string }, {
    route: context.routePath,
    kind: context.routeType,
    method: request.method,
  });
};
