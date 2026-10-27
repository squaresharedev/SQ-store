"use client";

import type { MouseEvent } from "react";
import { Star } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { formatFixed } from "@/lib/format/intl";
import { quietLinkClass } from "./product-page-maps";

/**
 * "★ 4.7 (13)" under the title: the rating at a glance, and a way to the
 * reviews it summarises.
 *
 * A plain link to the section's heading, so it works with no script and
 * scrolls smoothly where the page asks for it (globals.css, which also honours
 * reduced motion). In the editor's preview the same address would move the
 * seller's own URL, and several product pages can be open at once, so there
 * it scrolls THIS page's section instead.
 *
 * Only for a product with reviews to go to: the caller checks, because "no
 * reviews yet" has the section itself to say it, and a link to it from a bare
 * "★ 0.0" would say less.
 */
export function ReviewsLink({
  average,
  count,
  preview,
}: {
  average: number;
  count: number;
  preview: boolean;
}) {
  const t = useTranslations("ProductPage.reviews");
  const locale = useLocale() as Locale;
  const shown = formatFixed(average, 1, locale);

  function scrollWithinPage(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    event.currentTarget
      .closest("article")
      ?.querySelector("[data-product-section='reviews']")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <a
      href="#product-reviews"
      onClick={preview ? scrollWithinPage : undefined}
      aria-label={t("jump", { average: shown, count })}
      className={`inline-flex w-fit items-center gap-1 text-sm ${quietLinkClass}`}
      data-product-rating=""
      // A click here means "go to the reviews", not "open the Sections panel".
      data-setting-skip=""
    >
      <Star aria-hidden="true" className="size-4" fill="currentColor" strokeWidth={1.5} />
      <span className="font-medium tabular-nums">{shown}</span>
      <span className="opacity-70 tabular-nums">({count})</span>
    </a>
  );
}
