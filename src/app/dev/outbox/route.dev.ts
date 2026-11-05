import { readDevMessages, type OutboundChannel } from "@/lib/outbound/dev-outbox";

const CHANNELS: readonly OutboundChannel[] = ["email", "sms"];

/**
 * GET /dev/outbox — the local mailbox and phone.
 *
 * DEVELOPMENT ONLY, and 404 everywhere else. There is no session check and
 * there deliberately is not one: this exists so a developer on a laptop, and
 * the e2e suite, can read the verification code that a real deployment would
 * have emailed or texted. In production nothing is ever recorded (see
 * lib/outbound/dev-outbox.ts) AND this route does not answer, so there are two
 * independent reasons a live code can never be listed here.
 *
 * `?channel=email|sms` and `?to=` narrow the list, which is what a spec wants:
 * one seller's code, not whatever the last test left behind.
 */
export async function GET(request: Request): Promise<Response> {
  if (process.env.NODE_ENV !== "development") {
    return new Response(null, { status: 404 });
  }
  const params = new URL(request.url).searchParams;
  const channel = CHANNELS.find((value) => value === params.get("channel"));
  const to = params.get("to") ?? undefined;
  return Response.json(
    { messages: readDevMessages({ channel, to }) },
    { headers: { "cache-control": "no-store" } },
  );
}
