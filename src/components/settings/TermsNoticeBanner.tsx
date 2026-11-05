import Link from "@/components/ui/AppLink";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, FileText } from "lucide-react";
import { inlineLinkClass } from "@/components/ui/control-styles";
import { bannerStripClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";
import { formatLongDate } from "@/lib/format/date";
import { LEGAL_SETTINGS_PATH, agreementOutdated, type TermsStatus } from "@/lib/legal/terms-versions";

/**
 * The dashboard half of a Terms notice (the email is the other): a strip under
 * the top bar from the day a new version is on its way until this person has
 * read and agreed to it, or it takes effect and the Overview asks them instead.
 *
 * Nothing for someone who never agreed to anything: the welcome flow puts the
 * newest Terms in front of them anyway.
 */
export function TermsNoticeBanner({
  upcoming,
  acceptedVersion,
}: {
  upcoming: TermsStatus["upcoming"] | undefined;
  acceptedVersion: string | null;
}) {
  const t = useTranslations("Settings.legal.notice");
  const locale = useLocale();
  if (!upcoming || acceptedVersion === null) return null;
  if (!agreementOutdated(acceptedVersion, upcoming.version)) return null;

  return (
    <div role="note" aria-label={t("bannerLabel")} className={bannerStripClass} data-terms-notice-banner="">
      <FileText className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />
      <p className="min-w-0 flex-1 font-semibold text-foreground">
        {upcoming.effectiveAt
          ? t("title", { date: formatLongDate(upcoming.effectiveAt, locale) })
          : t("titleSoon")}
      </p>
      <Link
        href={LEGAL_SETTINGS_PATH}
        className={cn(inlineLinkClass, "inline-flex shrink-0 items-center gap-1")}
      >
        {t("bannerLink")}
        <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    </div>
  );
}
