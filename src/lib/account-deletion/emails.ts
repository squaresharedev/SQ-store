// SERVER ONLY. The two things a person is told about deleting their account:
// that it is scheduled (with the way to stop it), and that it is done.
//
// The first is also the safety net: a deletion asked for by someone who got
// into the account reaches the real owner's inbox with days left to undo it.
//
// Best-effort, like every notice: a mail that cannot be sent never changes
// what happens to the account, and never throws.

import { translatorFor } from "@/i18n/translator";
import type { Locale } from "@/i18n/locales";
import { appUrl } from "@/lib/app-url";
import { sendEmail } from "@/lib/email/send";
import { formatLongDate } from "@/lib/format/date";
import { SUPPORT_EMAIL } from "@/lib/site";

/** Where a request is undone. */
const DANGER_SETTINGS_PATH = "/settings/danger#delete";

async function deliver(kind: string, to: string, subject: string, lines: string[]): Promise<boolean> {
  try {
    const result = await sendEmail({ to, subject, text: lines.join("\n") });
    if (!result.sent && result.reason !== "disabled") {
      console.error(`[account deletion] ${kind} email was not sent:`, result.reason);
    }
    return result.sent;
  } catch (error) {
    console.error(`[account deletion] ${kind} email failed:`, error instanceof Error ? error.message : error);
    return false;
  }
}

/** "Your account will be deleted on ...", sent when the request is made. */
export async function sendDeletionScheduledEmail(
  to: string,
  locale: Locale,
  deleteOn: string,
): Promise<boolean> {
  const t = await translatorFor(locale);
  return deliver("scheduled", to, t("Settings.danger.email.scheduled.subject"), [
    t("Settings.danger.email.scheduled.body", { date: formatLongDate(deleteOn, locale) }),
    "",
    t("Settings.danger.email.scheduled.undo", { url: appUrl(DANGER_SETTINGS_PATH) }),
    "",
    t("Settings.danger.email.notYou", { email: SUPPORT_EMAIL }),
  ]);
}

/** "Your account has been deleted", sent once it has. */
export async function sendAccountDeletedEmail(
  to: string,
  locale: Locale,
  requestedAt: string,
): Promise<boolean> {
  const t = await translatorFor(locale);
  return deliver("deleted", to, t("Settings.danger.email.deleted.subject"), [
    t("Settings.danger.email.deleted.body", { date: formatLongDate(requestedAt, locale) }),
    "",
    t("Settings.danger.email.notYou", { email: SUPPORT_EMAIL }),
  ]);
}
