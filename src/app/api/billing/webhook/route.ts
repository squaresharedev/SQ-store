import { stripeBillingConfigured } from "@/lib/billing/availability";
import { handleStripeEvent, parseStripeEvent } from "@/lib/billing/webhook";
import { verifyStripeSignature, webhookSecrets } from "@/lib/billing/webhook-signature";
import { readBoundedText } from "@/lib/security/read-json";

/**
 * POST /api/billing/webhook: Stripe Billing's events for the platform account.
 *
 * Deliberately NOT same-origin checked and NOT rate limited before the
 * signature: the caller is Stripe's servers, not a browser, and the signature
 * over the raw body IS the authentication. Nothing is read from the event
 * until it has verified. What a verified event may do is lib/billing/webhook.ts.
 *
 * Answers: 200 for anything verified (handled or deliberately ignored, so
 * Stripe stops sending it), 400 for a request that is not a genuine Stripe
 * event, 500 when our side failed and the event should come again, and 404
 * when billing is not configured in this deployment at all.
 */

/** Stripe's events are a few kilobytes; nothing legitimate comes near this. */
const BODY_MAX_BYTES = 256 * 1024;

function reply(status: number): Response {
  return new Response(null, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!stripeBillingConfigured()) return reply(404);

  const body = await readBoundedText(request, BODY_MAX_BYTES);
  if (!body.ok) return reply(body.reason === "too_large" ? 413 : 400);

  const signature = await verifyStripeSignature(
    body.text,
    request.headers.get("stripe-signature"),
    webhookSecrets(),
  );
  if (!signature.ok) {
    console.warn(`[billing] webhook refused: signature ${signature.reason}`);
    return reply(400);
  }

  const event = parseStripeEvent(body.text);
  if (!event) return reply(400);

  const outcome = await handleStripeEvent(event);
  return reply(outcome.status);
}
