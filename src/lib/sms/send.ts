// SERVER ONLY. The ONE place a text message leaves this app.
//
// The same shape as lib/email/send.ts, on the same provider (Brevo's
// transactional SMS API, lib/outbound/brevo.ts), and OFF UNLESS CONFIGURED.
// Production needs all three of:
//
//   SMS_SENDER     the sender name shown on the phone, up to 11 letters or
//                  digits (e.g. "Squareshare"); some countries replace it
//   SMS_ENABLED    "true"
//   BREVO_API_KEY  Worker secret, shared with email (wrangler secret put)
//
// plus SMS credit on the Brevo account. Until the first two are set,
// {@link smsSendingEnabled} is false and a phone number simply cannot be
// proven, which only means buyers are not shown it: a phone is never required
// to sell (lib/settings/trader-identity.ts).
//
// Texts cost money per message, which makes this the one outbound channel an
// attacker can profit from abusing (SMS pumping). Every caller must go through
// lib/contact-verification, which restricts destinations to SMS_REGIONS and
// spends per-account, per-number, per-client and platform-wide budgets before
// anything reaches this module.

import { OutboundMisconfiguredError, brevoPost } from "@/lib/outbound/brevo";
import { printDevMessage, recordDevMessage } from "@/lib/outbound/dev-outbox";
import type { SendResult } from "@/lib/email/send";

export type OutboundSms = {
  /** E.164, e.g. "+353871234567". Normalised by lib/validation/phone.ts. */
  to: string;
  text: string;
};

/**
 * The GSM 03.38 alphabet (basic set plus the escaped extension characters).
 * A message entirely in it travels as 160-character segments; anything else
 * ("ř", "ł", "ő") must go as Unicode, 70 per segment, or the carrier swaps
 * the letters for "?".
 */
const GSM_7 =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà^{}\\[~]|€";
const GSM_7_SET: ReadonlySet<string> = new Set(GSM_7);

export function isGsm7(text: string): boolean {
  for (const char of text) if (!GSM_7_SET.has(char)) return false;
  return true;
}

/** The sender name on the recipient's phone. */
export function smsSenderName(): string | undefined {
  return process.env.SMS_SENDER?.trim() || undefined;
}

/** Can this deployment actually send a text? */
export function smsSendingEnabled(): boolean {
  if (!smsSenderName()) return false;
  // In development the console and the dev outbox stand in for the phone.
  if (process.env.NODE_ENV === "development") return true;
  return process.env.SMS_ENABLED === "true";
}

/** The one call that reaches the provider. Swap this to change providers. */
async function deliver(message: OutboundSms, sender: string): Promise<void> {
  if (process.env.NODE_ENV === "development") {
    const record = { channel: "sms" as const, ...message, from: sender, at: new Date().toISOString() };
    recordDevMessage(record);
    printDevMessage(record);
    return;
  }

  await brevoPost("/transactionalSMS/sms", {
    sender,
    // Brevo takes the number with or without "+"; E.164 is what we store.
    recipient: message.to,
    content: message.text,
    unicodeEnabled: !isGsm7(message.text),
    type: "transactional",
    tag: "contact-verification",
  });
}

/**
 * Send one text. Same contract as sendEmail: an ordinary failure is a result,
 * a misconfigured deployment throws.
 */
export async function sendSms(message: OutboundSms): Promise<SendResult> {
  const sender = smsSenderName();
  if (!sender || !smsSendingEnabled()) return { sent: false, reason: "disabled" };

  try {
    await deliver(message, sender);
    return { sent: true };
  } catch (error) {
    if (error instanceof OutboundMisconfiguredError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    // Never the text itself: it carries a verification code.
    console.error("[sms] send failed:", detail);
    return { sent: false, reason: "failed", detail };
  }
}
