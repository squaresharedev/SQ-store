"use client";

import { ExternalLink } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { focusRingInsetClass, helpTextClass } from "@/components/ui/control-styles";
import { formatLongCalendarDate } from "@/lib/format/calendar";
import { LEGAL_LINKS } from "@/lib/legal/links";
import { TERMS_LAST_UPDATED, TERMS_SUMMARY } from "@/lib/legal/terms-summary";
import { cn } from "@/lib/utils";

const linkClass =
  "font-medium text-foreground underline underline-offset-2 hover:no-underline";

/**
 * The short version of the Terms of Service in a scroll box, with the full
 * Terms one click away above it and again at its end.
 *
 * Agreeing is never held back until the box has been scrolled: a seller
 * reads as much as they choose, and the agreement records which version was on
 * screen either way.
 *
 * The box is a focusable region so a keyboard can scroll it (and axe's
 * scrollable-region-focusable holds).
 */
export function TermsSummary({ className }: { className?: string }) {
  const t = useTranslations("Settings.legal.termsSummary");
  const tKey = useTranslations();
  const locale = useLocale();

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <p className={helpTextClass}>
        {t("intro", { date: formatLongCalendarDate(TERMS_LAST_UPDATED, locale) })}{" "}
        <a
          href={LEGAL_LINKS.terms.href}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(linkClass, "inline-flex items-center gap-1")}
          data-terms-full-link
        >
          {t("fullTermsLink")}
          <ExternalLink className="size-3.5 shrink-0" aria-hidden />
          <span className="sr-only">{t("opensInNewTab")}</span>
        </a>
      </p>

      <div
        role="region"
        aria-label={t("regionLabel")}
        tabIndex={0}
        data-terms-summary
        className={cn(
          "max-h-72 overflow-y-auto overscroll-contain border border-border px-4 py-3",
          focusRingInsetClass,
        )}
      >
        <div className="flex flex-col gap-4">
          {TERMS_SUMMARY.map((section) => (
            <section key={section.heading} className="flex flex-col gap-1.5">
              <h3 className="text-sm font-semibold text-foreground">{tKey(section.heading)}</h3>
              <ul className="flex list-disc flex-col gap-1.5 pl-4 font-inter text-sm leading-relaxed text-muted-foreground marker:text-border">
                {section.points.map((point) => (
                  <li key={point}>{tKey(point)}</li>
                ))}
              </ul>
            </section>
          ))}
          <p className="border-t border-border pt-3 font-inter text-sm leading-relaxed text-foreground">
            {t.rich("footer", {
              terms: (chunks) => (
                <a
                  href={LEGAL_LINKS.terms.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkClass}
                >
                  {chunks}
                </a>
              ),
              privacy: (chunks) => (
                <a
                  href={LEGAL_LINKS.privacy.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkClass}
                >
                  {chunks}
                </a>
              ),
            })}
          </p>
        </div>
      </div>
    </div>
  );
}
