// SERVER ONLY. The ONE place outbound transactional mail leaves this app.
//
// THE PROVIDER is Brevo's SMTP relay (lib/email/smtp.ts), the same account and
// verified sender domain that already relays Supabase Auth's mail for this
// project. SMTP and not Brevo's REST API: the account locks that API to listed
// IP addresses, which a Worker does not have, and the relay's login can only
// send mail (see smtp.ts). If it is ever swapped out, replace {@link deliver}
// and nothing else changes.
//
// OFF UNLESS CONFIGURED, exactly like lib/turnstile.ts, lib/moderation and
// lib/sms/send.ts. Production needs all three of:
//
//   TRANSACTIONAL_EMAIL_FROM     an address on the domain verified in Brevo
//   TRANSACTIONAL_EMAIL_ENABLED  "true"
//   BREVO_SMTP_USER, BREVO_SMTP_KEY
//                                Worker secrets (wrangler secret put): Brevo's
//                                SMTP login, not an API key
//
// Until the first two are set, {@link emailSendingEnabled} is false everywhere
// and callers fall back to whatever they do without mail.
//
// FAILURE POLICY, mirroring lib/moderation's:
//
//   not configured         -> `{ sent: false, reason: "disabled" }`. The caller
//                             decides; nothing is silently swallowed.
//   enabled, no SMTP login -> throws. "Told to send and unable to" is a
//                             deployment fault and must surface, not be absorbed.
//   configured, send fails -> `{ sent: false, reason }`. The caller reports it.
//   development            -> NEVER sent. The message is printed and kept in
//                             the dev outbox (app/dev/outbox), which is what makes
//                             a verification flow drivable on a laptop and in
//                             the e2e stack without mailing a stranger. Gated on
//                             NODE_ENV so it can never become a production leak.

import { BREVO_SMTP_HOST, BREVO_SMTP_PORT, checkRelay, sendMail, type SmtpConfig } from "@/lib/email/smtp";
import { OutboundMisconfiguredError } from "@/lib/outbound/brevo";
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

/** The relay login, or the loud failure a deployment told to send without one deserves. */
function smtpConfig(): SmtpConfig {
  const user = process.env.BREVO_SMTP_USER?.trim();
  const pass = process.env.BREVO_SMTP_KEY?.trim();
  if (!user || !pass) {
    throw new OutboundMisconfiguredError(
      "Outbound delivery is enabled but BREVO_SMTP_USER / BREVO_SMTP_KEY are not set. Add them with `wrangler secret put`.",
    );
  }
  return { host: BREVO_SMTP_HOST, port: BREVO_SMTP_PORT, user, pass };
}

/** The one call that reaches the provider. Swap this to change providers. */
async function deliver(message: OutboundEmail, from: string): Promise<void> {
  if (process.env.NODE_ENV === "development") {
    const record = { channel: "email" as const, ...message, from, at: new Date().toISOString() };
    recordDevMessage(record);
    printDevMessage(record);
    return;
  }

  await sendMail(smtpConfig(), {
    fromName: message.fromName ?? SENDER_NAME,
    fromAddress: from,
    to: [message.to],
    ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    subject: message.subject,
    text: message.text,
    ...(message.html ? { html: message.html } : {}),
  });
}

/**
 * Logs in to the real relay and says nothing else: no message is sent. What the
 * deploy's smoke check asks (api/ops/mail-test), so every build proves its SMTP
 * client runs on Workers and the login is accepted. Throws on any failure.
 */
export async function checkMailRelay(): Promise<void> {
  await checkRelay(smtpConfig());
}

/**
 * One test message to `to`, through the real relay, regardless of the
 * TRANSACTIONAL_EMAIL_ENABLED switch: "does production mail work?" has to be
 * answerable BEFORE the switch is turned on. Never used for a user's mail
 * (api/ops/mail-test sends it to the ops mailbox only). Throws on any failure.
 */
export async function sendTestEmail(to: string): Promise<void> {
  const from = senderAddress();
  if (!from) throw new OutboundMisconfiguredError("TRANSACTIONAL_EMAIL_FROM is not set.");
  await sendMail(smtpConfig(), {
    fromName: SENDER_NAME,
    fromAddress: from,
    to: [to],
    subject: "[Square Share] Mail test from the dashboard",
    text: "This is a test sent by the dashboard through Brevo's SMTP relay. Nothing is wrong, and no user's mail goes through this check.",
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
