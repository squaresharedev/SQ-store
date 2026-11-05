// SERVER ONLY. Tells everyone about a new Terms version, then starts its clock.
//
// THE 30 DAYS RUN FROM THE LAST EMAIL, not from a date someone typed. So a late
// deploy, mail that was off, or a run that stopped halfway can only ever make the
// notice LONGER. The CHECK on terms_versions refuses anything shorter.
//
// IT REFUSES TO START, loudly, while nobody can be told or the text cannot be
// read: mail off, or the new version's page not on the marketing site yet. The
// route answers 500 and the scheduled job goes red, because a version quietly
// waiting forever is how a change gets forgotten.
//
// One version at a time, oldest first: a second change made while the first is
// still running gets its own full notice after it.

import { createAdminClient } from "@/lib/supabase/admin";
import { emailSendingEnabled, sendEmail, type SendResult } from "@/lib/email/send";
import { DEFAULT_LOCALE, parseLocale, type Locale } from "@/i18n/locales";
import { translatorFor } from "@/i18n/translator";
import { formatLongDate } from "@/lib/format/date";
import { LEGAL_LINKS } from "@/lib/legal/links";
import { TERMS_CHANGES } from "@/lib/legal/terms-changes";
import {
  LEGAL_SETTINGS_PATH,
  TERMS_NOTICE_DAYS,
  TERMS_VERSIONS,
  agreementOutdated,
  termsVersionUrl,
} from "@/lib/legal/terms-versions";
import { appUrl } from "@/lib/app-url";

/** Emails in one run: a Worker request is bounded, and the scheduler calls again
 *  while the answer says `more`. */
const BATCH_SIZE = 20;

/** Tries at one address before moving on, so a dead mailbox cannot hold up
 *  everyone's clock. That account still sees the notice in the dashboard. */
const MAX_ATTEMPTS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The stated date allows one extra day for the sending itself, so it holds
 *  unless sending takes longer than that. If it does, the date moves later. */
const PLANNED_DAYS = TERMS_NOTICE_DAYS + 1;

export class TermsNoticeBlocked extends Error {
  constructor(readonly reason: "mail_off" | "terms_page_missing") {
    super(`Terms notices cannot go out: ${reason}`);
  }
}

export type TermsVersionState = {
  version: string;
  notice_started_at: string | null;
  planned_effective_at: string | null;
  effective_at: string | null;
};

export type TermsRecipient = { userId: string; email: string; locale: Locale };
export type TermsSendRecord = { userId: string; sentAt: string | null; attempts: number };

export type TermsNoticeStore = {
  readVersions: () => Promise<TermsVersionState[]>;
  startNotice: (version: string, startedAt: string, plannedEffectiveAt: string, shortNoticeReason: string | null) => Promise<void>;
  /** Everyone with a confirmed email who has not already agreed to `version`. */
  recipients: (version: string) => Promise<TermsRecipient[]>;
  sends: (version: string) => Promise<TermsSendRecord[]>;
  recordSend: (version: string, userId: string, sentAt: string | null, attempts: number) => Promise<void>;
  completeNotice: (version: string, completedAt: string, effectiveAt: string) => Promise<void>;
};

export type TermsNoticeDeps = {
  store: TermsNoticeStore;
  now: () => Date;
  mailOn: () => boolean;
  termsPageLive: (version: string) => Promise<boolean>;
  send: (recipient: TermsRecipient, version: string, effectiveAt: string) => Promise<SendResult>;
};

export type TermsNoticeResult = {
  version: string | null;
  sent: number;
  failed: number;
  gaveUp: number;
  completed: boolean;
  /** Call again straight away: this run stopped at its batch limit. */
  more: boolean;
};

const NOTHING_DUE: TermsNoticeResult = { version: null, sent: 0, failed: 0, gaveUp: 0, completed: false, more: false };

export async function runTermsNotices(deps: TermsNoticeDeps = liveDeps()): Promise<TermsNoticeResult> {
  const { store, now } = deps;
  const rows = await store.readVersions();
  const byVersion = new Map(rows.map((row) => [row.version, row]));

  const due = TERMS_VERSIONS.find(({ version }) => !byVersion.get(version)?.effective_at);
  if (!due) return NOTHING_DUE;
  const { version } = due;
  const urgentReason = "urgentReason" in due ? (due.urgentReason as string) : null;

  if (!deps.mailOn()) throw new TermsNoticeBlocked("mail_off");
  if (!(await deps.termsPageLive(version))) throw new TermsNoticeBlocked("terms_page_missing");

  const started = now();
  let row = byVersion.get(version);
  let planned = row?.planned_effective_at ?? null;
  if (!row?.notice_started_at || !planned) {
    planned = new Date(started.getTime() + (urgentReason ? 0 : PLANNED_DAYS * DAY_MS)).toISOString();
    await store.startNotice(version, started.toISOString(), planned, urgentReason);
    row = { version, notice_started_at: started.toISOString(), planned_effective_at: planned, effective_at: null };
  }

  const [recipients, sends] = await Promise.all([store.recipients(version), store.sends(version)]);
  const record = new Map(sends.map((send) => [send.userId, send]));
  const unsent = recipients.filter((recipient) => !record.get(recipient.userId)?.sentAt);
  const gaveUp = unsent.filter((recipient) => (record.get(recipient.userId)?.attempts ?? 0) >= MAX_ATTEMPTS);
  const waiting = unsent.filter((recipient) => (record.get(recipient.userId)?.attempts ?? 0) < MAX_ATTEMPTS);
  const batch = waiting.slice(0, BATCH_SIZE);

  let sent = 0;
  let failed = 0;
  for (const recipient of batch) {
    const attempts = (record.get(recipient.userId)?.attempts ?? 0) + 1;
    const result = await deps.send(recipient, version, planned);
    if (result.sent) {
      sent += 1;
      await store.recordSend(version, recipient.userId, now().toISOString(), attempts);
    } else {
      failed += 1;
      await store.recordSend(version, recipient.userId, null, attempts);
    }
  }

  // Anyone who failed gets another try on the next call, so the clock waits.
  const more = waiting.length > sent;
  if (more) return { version, sent, failed, gaveUp: gaveUp.length, completed: false, more: true };

  const completed = now();
  const earliest = completed.getTime() + (urgentReason ? 0 : TERMS_NOTICE_DAYS * DAY_MS);
  const effectiveAt = new Date(Math.max(earliest, new Date(planned).getTime())).toISOString();
  await store.completeNotice(version, completed.toISOString(), effectiveAt);
  if (gaveUp.length > 0) {
    console.error(`[terms] ${version}: gave up emailing ${gaveUp.length} account(s); they still see the dashboard notice`);
  }
  return { version, sent, failed, gaveUp: gaveUp.length, completed: true, more: false };
}

/** The notice, in the reader's language. Service mail with a legal purpose, not
 *  marketing: everyone gets it, whatever their notification settings say. */
export async function sendTermsNotice(
  recipient: TermsRecipient,
  version: string,
  effectiveAt: string,
): Promise<SendResult> {
  const notice = await buildTermsNotice(recipient.locale, version, effectiveAt);
  return sendEmail({ to: recipient.email, ...notice });
}

/** The words of the notice, on their own so /dev/terms-notice can show them. */
export async function buildTermsNotice(
  locale: Locale,
  version: string,
  effectiveAt: string,
): Promise<{ subject: string; text: string }> {
  const t = await translatorFor(locale);
  const date = formatLongDate(effectiveAt, locale);
  const changes = TERMS_CHANGES[version] ?? [];
  const text = [
    t("Settings.legal.notice.email.intro", { date }),
    "",
    ...(changes.length > 0 ? [t("Settings.legal.notice.email.changes"), ...changes.map((key) => `- ${t(key)}`), ""] : []),
    t("Settings.legal.notice.email.readNew", { url: termsVersionUrl(version) }),
    t("Settings.legal.notice.email.readCurrent", { url: LEGAL_LINKS.terms.href }),
    "",
    t("Settings.legal.notice.email.nothingNow", { url: appUrl(LEGAL_SETTINGS_PATH) }),
    t("Settings.legal.notice.email.leave", { date }),
  ].join("\n");
  return { subject: t("Settings.legal.notice.email.subject"), text };
}

/** The marketing site has to be serving the new text before anyone is sent to
 *  it. On a laptop there is no such site, and mail goes to the dev outbox. */
async function termsPageLive(version: string): Promise<boolean> {
  if (process.env.NODE_ENV === "development") return true;
  try {
    const response = await fetch(termsVersionUrl(version), { method: "HEAD", redirect: "follow" });
    return response.ok;
  } catch {
    return false;
  }
}

function liveStore(): TermsNoticeStore {
  const admin = createAdminClient();
  const fail = (action: string, message: string) => new Error(`[terms] ${action}: ${message}`);

  return {
    async readVersions() {
      const { data, error } = await admin
        .from("terms_versions")
        .select("version, notice_started_at, planned_effective_at, effective_at");
      if (error) throw fail("read versions", error.message);
      return data ?? [];
    },
    async startNotice(version, startedAt, plannedEffectiveAt, shortNoticeReason) {
      const { error } = await admin.from("terms_versions").upsert({
        version,
        notice_started_at: startedAt,
        planned_effective_at: plannedEffectiveAt,
        short_notice_reason: shortNoticeReason,
      });
      if (error) throw fail("start notice", error.message);
    },
    async recipients(version) {
      const { data: profiles, error } = await admin.from("profiles").select("id, locale, legal_accepted_version");
      if (error) throw fail("read profiles", error.message);
      const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));

      const recipients: TermsRecipient[] = [];
      const perPage = 1000;
      for (let page = 1; ; page += 1) {
        const { data, error: listError } = await admin.auth.admin.listUsers({ page, perPage });
        if (listError) throw fail("list users", listError.message);
        for (const user of data.users) {
          const profile = profileById.get(user.id);
          if (!user.email || !user.email_confirmed_at) continue;
          // Already agreed to this version or a later one, so already told.
          const accepted = profile?.legal_accepted_version ?? null;
          if (accepted !== null && !agreementOutdated(accepted, version)) continue;
          recipients.push({
            userId: user.id,
            email: user.email,
            locale: parseLocale(profile?.locale) ?? DEFAULT_LOCALE,
          });
        }
        if (data.users.length < perPage) return recipients;
      }
    },
    async sends(version) {
      const { data, error } = await admin
        .from("terms_notice_sends")
        .select("user_id, sent_at, attempts")
        .eq("version", version);
      if (error) throw fail("read sends", error.message);
      return (data ?? []).map((row) => ({ userId: row.user_id, sentAt: row.sent_at, attempts: row.attempts }));
    },
    async recordSend(version, userId, sentAt, attempts) {
      const { error } = await admin
        .from("terms_notice_sends")
        .upsert({ version, user_id: userId, sent_at: sentAt, attempts });
      if (error) throw fail("record send", error.message);
    },
    async completeNotice(version, completedAt, effectiveAt) {
      const { error } = await admin
        .from("terms_versions")
        .update({ notice_completed_at: completedAt, effective_at: effectiveAt })
        .eq("version", version);
      if (error) throw fail("complete notice", error.message);
    },
  };
}

function liveDeps(): TermsNoticeDeps {
  return {
    store: liveStore(),
    now: () => new Date(),
    mailOn: emailSendingEnabled,
    termsPageLive,
    send: sendTermsNotice,
  };
}
