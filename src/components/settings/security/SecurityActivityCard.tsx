import { useLocale, useTranslations } from "next-intl";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { helpTextClass } from "@/components/ui/control-styles";
import type { MessageKey } from "@/i18n/types";
import type { Locale } from "@/i18n/locales";
import { dateTimeFormat, intlTag } from "@/lib/format/intl";
import { formatAge } from "@/lib/format/date";

export type SecurityActivityItem = {
  id: string;
  /** How the event reads, or null for a kind with no label (shown as `event`). */
  label: MessageKey | null;
  event: string;
  at: string;
};

const ACTIVITY_TIME: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
};

/**
 * The exact time, fixed to UTC and said so. This renders on the server, which
 * has no idea where the reader is, and a time that is silently in the wrong
 * zone is worse than one that is plainly labelled. It is the hover detail: the
 * row leads with how long ago it was ("3 hours ago"), which needs no zone to
 * match against the owner's own memory.
 */
function formatUtc(iso: string, locale: Locale): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return dateTimeFormat(intlTag(locale, "en-GB"), ACTIVITY_TIME).format(date);
}

/**
 * The account's own security log: password changes, 2FA changes, recovery
 * codes used, wrong codes at sign-in. Read-only. Its value is the entry the
 * owner does NOT recognise.
 */
export function SecurityActivityCard({ items }: { items: SecurityActivityItem[] | null }) {
  const t = useTranslations("Settings.security.activity");
  const tAll = useTranslations();
  const locale = useLocale();

  return (
    <SettingsCard id="activity" title={t("cardTitle")} description={t("cardDescription")}>
      {items === null ? (
        <p className={helpTextClass}>{t("unavailable")}</p>
      ) : items.length === 0 ? (
        <p className={helpTextClass}>{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-border" aria-label={t("cardTitle")}>
          {items.map((item) => {
            const time = formatUtc(item.at, locale);
            return (
              <li
                key={item.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5 first:pt-0 last:pb-0"
              >
                <span className="font-inter text-sm text-foreground">
                  {item.label ? tAll(item.label) : item.event}
                </span>
                <time
                  dateTime={item.at}
                  title={time === null ? undefined : t("timeUtc", { time })}
                  className="font-inter text-xs text-muted-foreground"
                >
                  {formatAge(item.at, locale) ?? ""}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </SettingsCard>
  );
}
