// SERVER ONLY. The ONE place outbound transactional mail leaves this app.
//
// THE PROVIDER is Brevo's transactional API (lib/outbound/brevo.ts), the same
// account and verified sender domain that already relays Supabase Auth's mail
// for this project. A plain HTTPS call, so it runs on Workers without SMTP. If
// it is ever swapped out, replace {@link deliver} and nothing else changes.
//
// OFF UNLESS CONFIGURED, exactly like lib/turnstile.ts, lib/moderation and
// lib/sms/send.ts. Production needs all three of:
//
//   TRANSACTIONAL_EMAIL_FROM     an address on the domain verified in Brevo
//   TRANSACTIONAL_EMAIL_ENABLED  "true"
//   BREVO_API_KEY                Worker secret (wrangler secret put)
//
// Until the first two are set, {@link emailSendingEnabled} is false everywhere
// and callers fall back to whatever they do without mail.
//
// FAILURE POLICY, mirroring lib/moderation's:
//
//   not configured         -> `{ sent: false, reason: "disabled" }`. The caller
//                             decides; nothing is silently swallowed.
//   enabled, no API key    -> throws. "Told to send and unable to" is a
//                             deployment fault and must surface, not be absorbed.
//   configured, send fails -> `{ sent: false, reason }`. The caller reports it.
//   development            -> NEVER sent. The message is printed and kept in
//                             the dev outbox (app/dev/outbox), which is what makes
//                             a verification flow drivable on a laptop and in
//                             the e2e stack without mailing a stranger. Gated on
//                             NODE_ENV so it can never become a production leak.

import { OutboundMisconfiguredError, brevoPost } from "@/lib/outbound/brevo";
import { printDevMessage, recordDevMessage } from "@/lib/outbound/dev-outbox";

export type OutboundEmail = {
  to: string;
  subject: string;
  /** Plain text is mandatory: a mail client that will not render HTML must
   *  still be able to act on the message. */
  text: string;
  html?: string;
  /**
   * Where a reply goes, when that is not us. Mail sent ON BEHALF of a seller
   * (an order has shipped) sets the seller's contact address here: the seller
   * is who the buyer bought from, so a reply must reach them, not Square Share.
   */
  replyTo?: string;
  /** The display name mail arrives from; {@link SENDER_NAME} when absent.
   *  The address itself is always {@link senderAddress}. */
  fromName?: string;
};

export type SendResult =
  | { sent: true }
  | { sent: false; reason: "disabled" | "failed"; detail?: string };

/** The name mail arrives from, beside {@link senderAddress}. */
const SENDER_NAME = "Squareshare";

/**
 * The address transactional mail is sent FROM. Must be a sender verified in
 * Brevo, or every send is refused.
 */
export function senderAddress(): string | undefined {
  return process.env.TRANSACTIONAL_EMAIL_FROM;
}

/**
 * Can this deployment actually send mail?
 *
 * Anything that gates a user's ability to sell on a received email MUST check
 * this first (see lib/contact-verification/availability.ts), which switches
 * its whole requirement off when this is false rather than locking sellers out
 * of a mailbox nobody can write to.
 */
export function emailSendingEnabled(): boolean {
  if (!senderAddress()) return false;
  // In development the console and the dev outbox stand in for the mail.
  if (process.env.NODE_ENV === "development") return true;
  return process.env.TRANSACTIONAL_EMAIL_ENABLED === "true";
}

/** The one call that reaches the provider. Swap this to change providers. */
async function deliver(message: OutboundEmail, from: string): Promise<void> {
  if (process.env.NODE_ENV === "development") {
    const record = { channel: "email" as const, ...message, from, at: new Date().toISOString() };
    recordDevMessage(record);
    printDevMessage(record);
    return;
  }

  await brevoPost("/smtp/email", {
    sender: { email: from, name: message.fromName ?? SENDER_NAME },
    to: [{ email: message.to }],
    ...(message.replyTo ? { replyTo: { email: message.replyTo } } : {}),
    subject: message.subject,
    textContent: message.text,
    ...(message.html ? { htmlContent: message.html } : {}),
  });
}

/**
 * Send one transactional email. Never throws for an ordinary delivery failure
 * (the caller gets a result and decides what to tell the user) but DOES throw
 * when the deployment is misconfigured, which is a different problem and must
 * not read as "the recipient's mail server was busy".
 */
export async function sendEmail(message: OutboundEmail): Promise<SendResult> {
  const from = senderAddress();
  if (!from || !emailSendingEnabled()) return { sent: false, reason: "disabled" };

  try {
    await deliver(message, from);
    return { sent: true };
  } catch (error) {
    if (error instanceof OutboundMisconfiguredError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    // The message body is never logged: it may carry a verification code.
    console.error("[email] send failed:", detail);
    return { sent: false, reason: "failed", detail };
  }
}
