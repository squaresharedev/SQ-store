// SERVER ONLY. The ONE place outbound transactional mail leaves this app.
//
// WHY CLOUDFLARE AND NOT A MAIL SDK. This deploys to Cloudflare Workers, which
// has no SMTP and no `nodemailer`. Cloudflare Email Service's Sending binding
// (public beta, Workers Paid plan) is `env.EMAIL.send({to, from, subject, ...})`
// — an in-runtime call with no third-party API key to hold, rotate or leak, and
// no extra vendor in the path of a legally required disclosure. That is the
// whole reason it is preferred over Resend/Postmark/SES here; if it is ever
// swapped out, replace {@link deliver} and nothing else changes.
//
// OFF UNLESS CONFIGURED, exactly like lib/turnstile.ts and lib/moderation. The
// binding is not in wrangler.jsonc yet, because Cloudflare requires the SENDER
// DOMAIN to be onboarded and verified in the Email Service dashboard first, and
// binding it before that would only turn every send into a runtime failure.
// Until someone does that, {@link emailSendingEnabled} is false everywhere and
// callers fall back to whatever they do without mail.
//
// FAILURE POLICY, mirroring lib/moderation's:
//
//   not configured        -> `{ sent: false, reason: "disabled" }`. The caller
//                            decides; nothing is silently swallowed.
//   configured, no binding-> throws. "Told to send and unable to" is a
//                            deployment fault and must surface, not be absorbed.
//   configured, send fails-> `{ sent: false, reason }`. The caller reports it.
//   development, no binding-> the message is LOGGED, in full, including any
//                            link in it. That is what makes a verification
//                            flow drivable on a laptop and in the e2e stack,
//                            and it is gated on NODE_ENV so it can never
//                            become a production leak.

import { recordDevEmail } from "@/lib/email/dev-outbox";

export type OutboundEmail = {
  to: string;
  subject: string;
  /** Plain text is mandatory: a mail client that will not render HTML must
   *  still be able to act on the message. */
  text: string;
  html?: string;
};

export type SendResult =
  | { sent: true }
  | { sent: false; reason: "disabled" | "failed"; detail?: string };

/**
 * The address transactional mail is sent FROM. Must be on a domain onboarded
 * to Cloudflare Email Service, or every send is refused with
 * E_SENDER_NOT_VERIFIED.
 */
export function senderAddress(): string | undefined {
  return process.env.TRANSACTIONAL_EMAIL_FROM;
}

/**
 * Can this deployment actually send mail?
 *
 * Both halves are required: an address to send from, and (outside development)
 * a binding to send with. Anything that gates a user's ability to sell on a
 * received email MUST check this first — see
 * lib/settings/seller-email-verification.ts, which switches its whole
 * requirement off when this is false rather than locking sellers out of a
 * mailbox nobody can write to.
 */
export function emailSendingEnabled(): boolean {
  if (!senderAddress()) return false;
  // In development the console stands in for the mail, so no binding needed.
  if (process.env.NODE_ENV === "development") return true;
  return process.env.TRANSACTIONAL_EMAIL_ENABLED === "true";
}

/** The Cloudflare Email Service binding, or undefined when not bound. */
async function emailBinding(): Promise<
  { send: (message: Record<string, unknown>) => Promise<unknown> } | undefined
> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = await getCloudflareContext({ async: true });
    return (env as Record<string, unknown>).EMAIL as
      | { send: (message: Record<string, unknown>) => Promise<unknown> }
      | undefined;
  } catch {
    // No Cloudflare context at all (plain `next dev`, vitest, the e2e stack).
    return undefined;
  }
}

/** The one call that touches the binding. Swap this to change providers. */
async function deliver(message: OutboundEmail, from: string): Promise<void> {
  const binding = await emailBinding();

  if (!binding) {
    if (process.env.NODE_ENV === "development") {
      // The dev fallback. Printed rather than sent, so the link in it is
      // usable from a terminal without any Cloudflare account at all, and
      // kept in a bounded in-memory outbox so a browser (and the e2e suite)
      // can reach it too. Both are development-only; see ./dev-outbox.ts.
      recordDevEmail({ ...message, from, at: new Date().toISOString() });
      console.info(
        [
          "",
          "──────── outbound email (dev: not actually sent) ────────",
          `from:    ${from}`,
          `to:      ${message.to}`,
          `subject: ${message.subject}`,
          "",
          message.text,
          "────────────────────────────────────────────────────────",
          "",
        ].join("\n"),
      );
      return;
    }
    throw new Error(
      "Transactional email is enabled but no EMAIL binding is present. Add a `send_email` binding to wrangler.jsonc and onboard the sender domain to Cloudflare Email Service.",
    );
  }

  await binding.send({
    to: message.to,
    from,
    subject: message.subject,
    text: message.text,
    ...(message.html ? { html: message.html } : {}),
  });
}

/**
 * Send one transactional email. Never throws for an ordinary delivery failure
 * — the caller gets a result and decides what to tell the user — but DOES
 * throw when the deployment is misconfigured, which is a different problem
 * and must not read as "the recipient's mail server was busy".
 */
export async function sendEmail(message: OutboundEmail): Promise<SendResult> {
  const from = senderAddress();
  if (!from || !emailSendingEnabled()) return { sent: false, reason: "disabled" };

  try {
    await deliver(message, from);
    return { sent: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (detail.includes("no EMAIL binding")) throw error;
    console.error("[email] send failed:", detail);
    return { sent: false, reason: "failed", detail };
  }
}
