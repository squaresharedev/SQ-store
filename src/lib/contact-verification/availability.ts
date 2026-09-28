// SERVER ONLY. Whether each kind of contact proof is switched on here.
//
// TWO DIFFERENT QUESTIONS, deliberately kept apart:
//
//   * Is a proven contact EMAIL required to publish? Whenever the platform can
//     send mail. A gate that demands a code nobody can deliver is a locked door
//     with no key, so with mail off the gate falls back to requiring the
//     address to be present (lib/settings/trader-identity.ts).
//
//   * Can a code for this channel actually be sent? The transport AND the code
//     key (CONTACT_VERIFICATION_KEY) must both be configured.
//
// They differ in exactly one case: mail configured, key missing. Then proof is
// still REQUIRED but cannot be given, so publishing stops and the logs say
// why. That is on purpose: the alternative is a missing secret silently
// switching the requirement off, which is the one failure a security control
// must never have.

import { emailSendingEnabled } from "@/lib/email/send";
import { smsSendingEnabled } from "@/lib/sms/send";
import { contactCodeKeyConfigured } from "@/lib/contact-verification/code";
import type { ContactChannel } from "@/lib/contact-verification/policy";

/** Is a PROVEN contact email required before anything is published or sold? */
export function emailProofRequired(): boolean {
  return emailSendingEnabled();
}

/** Can a code for this channel be sent from this deployment right now? */
export function contactChannelAvailable(channel: ContactChannel): boolean {
  const transport = channel === "email" ? emailSendingEnabled() : smsSendingEnabled();
  return transport && contactCodeKeyConfigured();
}

/** Both answers for both channels, for pages that render the controls. */
export function contactVerificationStatus(): Record<ContactChannel, boolean> & {
  emailRequired: boolean;
} {
  return {
    email: contactChannelAvailable("email"),
    phone: contactChannelAvailable("phone"),
    emailRequired: emailProofRequired(),
  };
}
