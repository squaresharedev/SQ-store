// SERVER ONLY. Something happened that a person at Square Share has to look
// at, and that nobody using the app will report.
//
// The case this exists for: money was taken and there is no order to show for
// it (a payment event that matches nothing, or names a store that is not the
// order's). A buyer in that state will write to the SELLER, who can see
// nothing either. Without this the only trace is a log line among thousands.
//
// TWO PLACES, always the log and, where configured, a mailbox:
//   - console.error with a fixed "[ops alert]" prefix, which is what a log
//     search or a Workers Logs alert rule keys on;
//   - an email to OPS_ALERT_EMAIL through the app's own mailer, when that
//     variable is set and mail is on. Unset is a normal deployment.
//
// NEVER THROWS, and never carries a secret or a buyer's details: ids only. It
// is called from inside a webhook, and an alert that fails must not turn a
// handled event into a retried one.

import { sendEmail } from "@/lib/email/send";

export async function alertOps(subject: string, facts: Record<string, string | number | null>): Promise<void> {
  const lines = Object.entries(facts).map(([name, value]) => `${name}: ${value ?? "none"}`);
  console.error(`[ops alert] ${subject}`, lines.join(" | "));

  const to = process.env.OPS_ALERT_EMAIL;
  if (!to) return;
  try {
    await sendEmail({ to, subject: `[Square Share] ${subject}`, text: lines.join("\n") });
  } catch (error) {
    console.error("[ops alert] could not be emailed:", error instanceof Error ? error.message : error);
  }
}
