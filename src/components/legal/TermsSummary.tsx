"use client";

import { useCallback, useEffect, useRef } from "react";
import { ExternalLink } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { focusRingInsetClass, helpTextClass } from "@/components/ui/control-styles";
import { formatLongCalendarDate } from "@/lib/format/calendar";
import { LEGAL_LINKS } from "@/lib/legal/links";
import { TERMS_LAST_UPDATED, TERMS_SUMMARY } from "@/lib/legal/terms-summary";
import { cn } from "@/lib/utils";

/** Slack for "at the end": zoom and subpixel layout rarely put scrollTop on
 *  the very last pixel. */
const END_SLACK_PX = 4;

const linkClass =
  "font-medium text-foreground underline underline-offset-2 hover:no-underline";

/**
 * The short version of the Terms of Service in a scroll box, with the full
 * Terms one click away above it and again at its end.
 *
 * Reports once, through `onReadToEnd`, when the reader has reached the bottom:
 * the place that records agreement keeps its button shut until then, so "I
 * have read" follows the reading rather than preceding it. A box that already
 * fits without scrolling (a tall screen, small text) counts as read as soon as
 * it has laid out; one that has not laid out yet (zero height) does not.
 *
 * The box is a focusable region so a keyboard can scroll it (and axe's
 * scrollable-region-focusable holds). Tabbing to the links at its end scrolls
 * them into view, which reaches the end the same way a wheel does.
 */
export function TermsSummary({
  onReadToEnd,
  className,
}: {
  onReadToEnd: () => void;
  className?: string;
}) {
  const t = useTranslations("Settings.legal.termsSummary");
  const tKey = useTranslations();
  const locale = useLocale();
  const boxRef = useRef<HTMLDivElement>(null);
  const reportedRef = useRef(false);
  // The latest callback, so the observer below is set up once per mount.
  const onReadToEndRef = useRef(onReadToEnd);
  useEffect(() => {
    onReadToEndRef.current = onReadToEnd;
  });

  const check = useCallback(() => {
    const box = boxRef.current;
    if (!box || reportedRef.current || box.clientHeight === 0) return;
    if (box.scrollTop + box.clientHeight >= box.scrollHeight - END_SLACK_PX) {
      reportedRef.current = true;
      onReadToEndRef.current();
    }
  }, []);

  useEffect(() => {
    check();
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(check);
    observer.observe(box);
    return () => observer.disconnect();
  }, [check]);

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
        ref={boxRef}
        onScroll={check}
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
