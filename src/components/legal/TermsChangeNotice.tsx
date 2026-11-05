"use client";

import { useLocale, useTranslations } from "next-intl";
import { inlineLinkClass } from "@/components/ui/control-styles";
import { formatLongDate } from "@/lib/format/date";
import { LEGAL_LINKS } from "@/lib/legal/links";
import { TERMS_CHANGES } from "@/lib/legal/terms-changes";
import { termsVersionUrl, type TermsStatus } from "@/lib/legal/terms-versions";

/**
 * What is changing in the Terms, in Settings › Legal: when, the old and new
 * wording a click apart, and that leaving is free. The dashboard half of what
 * section 19 of the Terms promises; the email says the same.
 */
export function TermsChangeNotice({
  upcoming,
}: {
  upcoming: NonNullable<TermsStatus["upcoming"]>;
}) {
  const t = useTranslations("Settings.legal.notice");
  const tKey = useTranslations();
  const locale = useLocale();
  const external = { target: "_blank", rel: "noopener noreferrer", className: inlineLinkClass };

  return (
    <section
      className="flex flex-col gap-2 border border-border bg-accent px-4 py-3 font-inter text-sm text-foreground"
      data-terms-change-notice=""
    >
      <h3 className="font-semibold">
        {upcoming.effectiveAt
          ? t("title", { date: formatLongDate(upcoming.effectiveAt, locale) })
          : t("titleSoon")}
      </h3>
      <p className="text-muted-foreground">
        {t.rich("body", {
          current: (chunks) => (
            <a href={LEGAL_LINKS.terms.href} {...external}>
              {chunks}
            </a>
          ),
          next: (chunks) => (
            <a href={termsVersionUrl(upcoming.version)} {...external}>
              {chunks}
            </a>
          ),
        })}
      </p>
      <ul className="flex list-disc flex-col gap-1 pl-4 text-muted-foreground marker:text-border">
        {(TERMS_CHANGES[upcoming.version] ?? []).map((key) => (
          <li key={key}>{tKey(key)}</li>
        ))}
      </ul>
      <p className="text-muted-foreground">{t("leave")}</p>
    </section>
  );
}
