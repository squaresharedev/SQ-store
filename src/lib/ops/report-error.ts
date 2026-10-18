// SERVER ONLY. One place every unhandled server error passes through
// (src/instrumentation.ts), so a failure a user hit is a line somebody can
// find instead of a stack trace among thousands of request logs.
//
// TWO PLACES, like lib/ops/alert.ts:
//   - console.error, one line of JSON behind a fixed "[server error]" prefix,
//     which is what a log search or a Workers Logs alert rule keys on;
//   - a POST to ERROR_REPORT_URL when that is set (any collector that takes
//     JSON: an error tracker's ingest endpoint, a chat webhook, a queue), with
//     ERROR_REPORT_TOKEN as a bearer token when the collector wants one.
//     Unset is a normal deployment.
//
// WHAT IS NEVER REPORTED: the request's real path, its query, headers, cookies
// or body. A buyer's order link carries its credential IN the path, and a
// header carries a session. The route's own pattern ("/s/[storefrontId]/order/
// [orderRef]") says where it broke without saying for whom.
//
// NEVER THROWS, and never waits long: a failing collector must not turn one
// error into two, or hold a response open.

/** How long the collector gets before the report is dropped. */
const REPORT_TIMEOUT_MS = 2000;
/** The most of an error's message that is logged or sent. */
const MESSAGE_MAX = 500;

export type ServerErrorContext = {
  /** The route's file pattern, never the address that was requested. */
  route: string;
  /** render | route | action | proxy. */
  kind: string;
  method: string;
};

export async function reportServerError(
  error: Error & { digest?: string },
  context: ServerErrorContext,
): Promise<void> {
  const report = {
    // What the error page shows the user, so a report from one finds the other.
    digest: error.digest ?? null,
    name: error.name,
    message: error.message.slice(0, MESSAGE_MAX),
    ...context,
    at: new Date().toISOString(),
  };
  console.error("[server error]", JSON.stringify(report));

  const url = process.env.ERROR_REPORT_URL;
  if (!url) return;
  try {
    const token = process.env.ERROR_REPORT_TOKEN;
    await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
    });
  } catch (failure) {
    console.error("[server error] could not be reported:", failure instanceof Error ? failure.message : failure);
  }
}
