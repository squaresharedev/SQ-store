// SERVER ONLY. The one email the team feature sends: the invite.
//
// An invite used to be a row and nothing else. Someone who already had an
// account found it in their bell; someone who did not was never told, and the
// inviter was shown a success message for an invitation nobody received.
//
// PLAIN TEXT, like every other mail this app sends (lib/orders/emails.ts).
//
// ADDRESSED TO A STRANGER, by someone else's choice, so it says as little as
// it can: who invited them, as what, and how to accept. The only thing in it
// the inviter controls is the store's handle, which the app has already
// restricted to a username. The link is ours (appUrl), never typed.
//
// IN THE INVITER'S LANGUAGE. Nothing is known about the reader yet, and the
// person inviting them is the best guess there is at what they read.
//
// Rate limited where it is triggered (inviteMember), keyed on the inviter.

import { appUrl } from "@/lib/app-url";
import { signInPath } from "@/lib/auth/paths";
import { sendEmail, type SendResult } from "@/lib/email/send";
import { SETTINGS_TEAM_PATH } from "@/lib/team/paths";
import { translatorFor } from "@/i18n/translator";
import type { Locale } from "@/i18n/locales";
import type { TeamRole } from "@/lib/team/permissions";

export type TeamInviteEmail = {
  to: string;
  /** The inviting store's handle, when it has one. */
  store: string | null;
  role: TeamRole;
  locale: Locale;
};

export async function sendTeamInviteEmail(invite: TeamInviteEmail): Promise<SendResult> {
  const t = await translatorFor(invite.locale);
  const store = invite.store;
  const lines = [
    store
      ? t("Settings.team.inviteEmail.intro", { store })
      : t("Settings.team.inviteEmail.introUnnamed"),
    t("Settings.team.inviteEmail.role", {
      role: t(`Settings.team.roles.${invite.role}.label`),
    }),
    "",
    t("Settings.team.inviteEmail.how", { email: invite.to }),
    // Through sign-in, which carries on to Team once they are in.
    appUrl(signInPath(SETTINGS_TEAM_PATH)),
    "",
    t("Settings.team.inviteEmail.ignore"),
  ];
  return sendEmail({
    to: invite.to,
    subject: store
      ? t("Settings.team.inviteEmail.subject", { store })
      : t("Settings.team.inviteEmail.subjectUnnamed"),
    text: lines.join("\n"),
  });
}
