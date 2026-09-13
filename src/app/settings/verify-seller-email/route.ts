import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { RATE_LIMITS, clientKey, rateLimitKey } from "@/lib/rate-limit";
import { consumeSellerEmailVerification } from "@/lib/settings/seller-email-verification";

/**
 * GET /settings/verify-seller-email?token=… — the link in the confirmation
 * email.
 *
 * A GET with a side effect, which is normally a smell, but a mail client can
 * only ever issue a GET and the "correct" alternative — a landing page with a
 * Confirm button — buys nothing here: the token is single-use, scoped to one
 * address, and expires, so a prefetching mail scanner burning it costs the
 * seller a resend rather than anything irreversible.
 *
 * DELIBERATELY UNAUTHENTICATED. The link is opened from an inbox, quite
 * possibly on a device with no session, and demanding a sign-in first would
 * mean the address is only ever confirmed by someone who could already reach
 * Settings. Possession of the token IS the proof, which is what the token is
 * for; the module it calls scopes every effect to the account and address that
 * token was issued for.
 *
 * Rate limited per client, keyed on IP because there is no session: without it
 * this is an oracle a script could grind against, one 64-hex guess at a time.
 *
 * Always redirects to Settings with a `verified=` outcome rather than
 * rendering; the page reads it and raises the toast, so there is exactly one
 * place that describes what happened.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const settings = new URL("/settings/tax", url.origin);

  const who = await clientKey(await headers());
  if (!(await rateLimitKey(who, "seller_email_verify", RATE_LIMITS.sellerEmailVerify))) {
    settings.searchParams.set("verified", "throttled");
    return NextResponse.redirect(settings, { status: 303 });
  }

  const outcome = await consumeSellerEmailVerification(token);
  settings.searchParams.set("verified", outcome.status);
  // 303: the browser must follow with a GET, and the result of this link is
  // not a page to cache or re-submit.
  return NextResponse.redirect(settings, { status: 303 });
}
