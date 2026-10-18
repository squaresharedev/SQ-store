"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { FooterDot } from "@/components/product-page/PoweredByFooter";
import { quietLinkClass, ruleColor } from "@/components/product-page/product-page-maps";
import { CustomFontFace } from "@/components/storefront/CustomFontFace";
import { LEGAL_LINKS, SQUARESHARE_SITE } from "@/lib/legal/links";
import { storefrontDisplayName } from "@/lib/storefront/display-name";
import { REPORT_FRAGMENT } from "@/lib/storefront/product-page-url";
import { cn } from "@/lib/utils";
import type { StorefrontPageData } from "@/types/storefront-page";
import { StorefrontBoard, storefrontSurface } from "./StorefrontBoard";
import { useEmbedFrameReport } from "./useEmbedFrameReport";

/**
 * A STOREFRONT INSIDE A SELLER'S OWN WEBSITE: the embed frame (/e/[key]/[site]).
 *
 * The same board as the hosted page (StorefrontBoard), in a frame the seller's
 * page sizes to fit. A product tile opens that product's hosted page in a tab
 * of its own: the seller's page stays put behind it, and buying happens on a
 * page whose address the buyer can read.
 *
 * NOTHING HERE DOES ANYTHING BUT LINK. No form, no dialog, no script-driven
 * navigation: the frame is sandboxed by the loader that creates it
 * (public/widget.js) to exactly "may run its own script and open a link in a
 * new tab", and every element below fits inside that. Every link is a plain
 * <a>, never next/link: a client-side navigation would swap this document for
 * a page that was never cleared to be framed.
 *
 * THE FOOT IS ONE LINE, not the hosted pages' footer: who sells this, whose
 * software it is, our privacy notice (this frame is where a visitor's request
 * first reaches us), and a way to report the storefront, which lands on the
 * hosted page's own report link. The sentence about who is party to a sale is
 * on the product page and the checkout, where a sale is made.
 */
export function EmbedFrameView({
  page,
  site,
}: {
  page: StorefrontPageData;
  /** The embedding site's host: where the frame's one message is addressed. */
  site: string;
}) {
  const t = useTranslations("ProductPage");
  const rootRef = useRef<HTMLDivElement>(null);
  const { theme } = page;
  const surface = storefrontSurface(page);
  const displayName = storefrontDisplayName(page);
  const soldBy = page.seller.businessName || page.name;

  // The frame's title on the seller's page says what the board's own label
  // says: one sentence, already in every language.
  useEmbedFrameReport(rootRef, site, t("storefront.gridLabel", { store: displayName }));

  return (
    <div
      ref={rootRef}
      // No min-height: the frame is exactly as tall as this element says it is.
      className={cn("@container relative isolate flex w-full flex-col", surface.className)}
      style={surface.style}
      data-embed-frame={page.id}
      data-page-ink={surface.ink}
    >
      <CustomFontFace customFont={theme.customFont} url={page.customFontUrl} />
      {/* A GUEST IN SOMEONE ELSE'S PAGE, so no landmarks and no top heading of
          its own: the seller's page already has its <main>, its footer and its
          <h1>, and a reader moving by landmark or heading meets this frame as
          part of that page. It is named one level down, and its two parts are
          plain boxes. (The hosted page, which IS the page, uses all three.) */}
      <h2 className="sr-only">{displayName}</h2>
      <div className="w-full px-4 py-5 @md:px-6">
        <StorefrontBoard page={page} displayName={displayName} tilesOpenNewTab />
      </div>
      <div className="w-full border-t" style={{ borderColor: ruleColor(surface.ink) }} data-embed-frame-footer="">
        {/* opacity-70: the muted level the hosted pages' footer already proved
            against WCAG AA for text this size (see PoweredByFooter). */}
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 px-4 py-3 text-center text-xs opacity-70">
          <span data-embed-frame-seller="">{t("soldBy", { seller: soldBy })}</span>
          <FooterDot />
          <a href={SQUARESHARE_SITE} target="_blank" rel="noopener noreferrer" className={quietLinkClass}>
            {t.rich("footer.poweredBy", {
              brand: (chunks) => <span className="font-medium">{chunks}</span>,
            })}
          </a>
          <FooterDot />
          <a
            href={LEGAL_LINKS.privacy.href}
            target="_blank"
            rel="noopener noreferrer"
            // Spelled out: beside a seller's own content an unqualified
            // "Privacy" reads as the seller's policy.
            aria-label={t("footer.policies.privacy.name")}
            className={quietLinkClass}
          >
            {t("footer.policies.privacy.label")}
          </a>
          <FooterDot />
          <a
            href={`${page.url}#${REPORT_FRAGMENT}`}
            target="_blank"
            rel="noopener noreferrer"
            className={quietLinkClass}
            data-embed-frame-report=""
          >
            {t("report.trigger", { target: "storefront" })}
          </a>
        </div>
      </div>
    </div>
  );
}
