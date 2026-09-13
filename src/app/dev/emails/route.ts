import { readDevEmails } from "@/lib/email/dev-outbox";

/**
 * GET /dev/emails — the local mailbox.
 *
 * DEVELOPMENT ONLY, and 404 everywhere else. There is no session check and
 * there deliberately is not one: this exists so a developer on a laptop, and
 * the e2e suite, can read the confirmation link that a real deployment would
 * have emailed. In production nothing is ever recorded (see
 * lib/email/dev-outbox.ts) AND this route does not answer, so there are two
 * independent reasons a live verification link can never be listed here.
 *
 * `?to=` narrows to one recipient, which is what a spec wants: one seller's
 * link, not whatever the last test left behind.
 */
export async function GET(request: Request): Promise<Response> {
  if (process.env.NODE_ENV !== "development") {
    return new Response(null, { status: 404 });
  }
  const to = new URL(request.url).searchParams.get("to") ?? undefined;
  return Response.json(
    { emails: readDevEmails(to) },
    { headers: { "cache-control": "no-store" } },
  );
}
