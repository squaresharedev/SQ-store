"use client";

import type { MouseEvent } from "react";
import { Star } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { formatFixed } from "@/lib/format/intl";
import { useCanvasCamera } from "@/lib/storefront/canvas-camera";
import { quietLinkClass } from "./product-page-maps";

/**
 * "★ 4.7 (13)" under the title: the rating at a glance, and a way to the
 * reviews it summarises.
 *
 * A plain link to the section's heading, so it works with no script and
 * scrolls smoothly where the page asks for it (globals.css, which also honours
 * reduced motion). In the editor's preview the same address would move the
 * seller's own URL, and several product pages can be open at once, so there
 * it goes to THIS page's section instead. On the canvas that means moving the
 * camera, never scrolling: the page is a card that clips to its own height,
 * and scrolling it slid the page up under the card with no way back (see
 * canvas-camera). With no canvas around it, it scrolls like a page does.
 *
 * Only for a product with reviews to go to: the caller checks, because "no
 * reviews yet" has the section itself to say it, and a link to it from a bare
 * "★ 0.0" would say less.
 */
export function ReviewsLink({
  average,
  count,
  starColor,
  preview,
}: {
  average: number;
  count: number;
  starColor: string;
  preview: boolean;
}) {
  const t = useTranslations("ProductPage.reviews");
  const locale = useLocale() as Locale;
  const shown = formatFixed(average, 1, locale);
  const camera = useCanvasCamera();

  function goWithinPage(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    const section = event.currentTarget
      .closest("article")
      ?.querySelector("[data-product-section='reviews']");
    if (!section) return;
    if (camera) camera.jumpTo(section);
    else section.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <a
      href="#product-reviews"
      onClick={preview ? goWithinPage : undefined}
      aria-label={t("jump", { average: shown, count })}
      className={`inline-flex w-fit items-center gap-1 text-sm ${quietLinkClass}`}
      data-product-rating=""
      // A click here means "go to the reviews", not "open the Sections panel".
      data-setting-skip=""
    >
      <Star aria-hidden="true" className="size-4" style={{ color: starColor }} fill="currentColor" strokeWidth={1.5} />
      <span className="font-medium tabular-nums">{shown}</span>
      <span className="opacity-70 tabular-nums">({count})</span>
    </a>
  );
}
