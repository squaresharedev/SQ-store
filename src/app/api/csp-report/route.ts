/**
 * CSP violation sink for the report-only policy in next.config.ts.
 *
 * The policy ships as Content-Security-Policy-Report-Only so it can be watched
 * before it is enforced, and a report-only policy with nowhere to report is an
 * inert header: browsers refuse to act on it at all and log
 * "does not specify a 'report-to'; the policy will have no effect" on every
 * page load. This is that destination.
 *
 * PUBLIC AND UNAUTHENTICATED BY NECESSITY. Browsers post reports without
 * credentials and ignore failures, so there is no session to check and nothing
 * to tell the caller. That makes it a write-only hole anyone can post to, which
 * is why it does exactly three things: cap the body, log one line, return 204.
 * No database, no fan-out, no reflection of the payload back to the caller.
 *
 * READING THE REPORTS: they land in the Worker's logs (`wrangler tail`, or the
 * Cloudflare dashboard). When a deploy's reports come back clean, rename the
 * header to "Content-Security-Policy" to enforce, and put `frame-ancestors`
 * back in the policy at the same time (it is ignored while report-only).
 */

/** Bigger than any real report; past this we are being fed, not reported to. */
const MAX_BODY_BYTES = 64 * 1024;

/** The two content types browsers actually use: the Reporting API sends
 *  `application/reports+json` (an ARRAY of reports), the older
 *  report-uri path sends `application/csp-report` (a single object). */
const ACCEPTED = ["application/reports+json", "application/csp-report", "application/json"];

export async function POST(request: Request): Promise<Response> {
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!ACCEPTED.includes(type)) return new Response(null, { status: 204 });

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return new Response(null, { status: 204 });

  let body: string;
  try {
    body = await request.text();
  } catch {
    return new Response(null, { status: 204 });
  }
  // content-length is a claim, not a fact; check what actually arrived too.
  if (body.length > MAX_BODY_BYTES) return new Response(null, { status: 204 });

  for (const report of normalise(body)) {
    // One compact line per violation. The directive and the blocked URI are
    // the two fields that decide whether the policy is wrong or the page is.
    console.warn(
      `[csp] ${report.directive ?? "?"} blocked ${report.blocked ?? "?"} on ${report.document ?? "?"}`,
    );
  }

  // 204 whatever happened: the browser does not read this response, and a
  // failing status would only add retries.
  return new Response(null, { status: 204 });
}

type Violation = {
  directive?: string;
  blocked?: string;
  document?: string;
};

/**
 * Flatten either payload shape into a common list. Anything unparseable yields
 * nothing rather than throwing: a malformed report is not worth a 500 on a
 * route whose caller ignores the response.
 */
function normalise(body: string): Violation[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }

  // Reporting API: [{ type: "csp-violation", body: { effectiveDirective, ... } }]
  if (Array.isArray(parsed)) {
    return parsed.flatMap((entry) => {
      const inner = pick(pick(entry, "body"), null);
      return inner ? [toViolation(inner)] : [];
    });
  }

  // report-uri: { "csp-report": { "violated-directive", "blocked-uri", ... } }
  const legacy = pick(parsed, "csp-report");
  if (legacy) return [toViolation(legacy)];

  return [];
}

/** Read a nested object property, or the object itself when key is null. */
function pick(value: unknown, key: string | null): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  if (key === null) return value as Record<string, unknown>;
  const inner = (value as Record<string, unknown>)[key];
  return typeof inner === "object" && inner !== null
    ? (inner as Record<string, unknown>)
    : null;
}

function toViolation(source: Record<string, unknown>): Violation {
  const str = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = source[key];
      // Cap each field: these end up in logs, and the blocked URI is attacker
      // -influenced in exactly the case this endpoint exists to catch.
      if (typeof value === "string" && value) return value.slice(0, 300);
    }
    return undefined;
  };
  return {
    directive: str("effectiveDirective", "violated-directive", "effective-directive"),
    blocked: str("blockedURL", "blocked-uri"),
    document: str("documentURL", "document-uri"),
  };
}
