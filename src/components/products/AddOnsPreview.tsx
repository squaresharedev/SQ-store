"use client";

import { useRef } from "react";
import { ArrowRight, Eye } from "lucide-react";
import { useTranslations } from "next-intl";
import { useInView } from "motion/react";
import { fontPresentation } from "@/lib/theme/storefront-fonts";
import { cn } from "@/lib/utils";
import { AddOnsProvider } from "@/components/product-page/AddOnsContext";
import {
  AddOnAddButton,
  addOnFrameStyle,
  addOnInnerRadius,
  AddOnsSection,
} from "@/components/product-page/AddOnsSection";
import {
  CTA_BUTTON_CLASS,
  ctaStyle,
  LIGHT_INK,
  resolveCta,
  resolveInk,
  ruleColor,
  subtleFill,
  surfaceRadius,
} from "@/components/product-page/product-page-maps";
import { useNaturalSize } from "@/components/storefront/useNaturalSize";
import { helpTextClass, labelClass } from "@/components/ui/control-styles";
import { useStoryBeats } from "@/components/ui/story-motion";
import { placeholderBarClass } from "@/components/ui/surface-styles";
import type { AddOnCard, HiddenAddOn } from "@/types/product";
import { DEFAULT_PRODUCT_PAGE_CONFIG, DEFAULT_STOREFRONT_CONFIG } from "@/types/storefront";

/** How wide the product page's buy box really is at full size, in px: laid out
 *  at this width and only then shrunk, so the preview has the page's proportions. */
const BUY_BOX_WIDTH = 486;
/** The same on a 390px phone. A column narrower than this draws the phone's
 *  page, which is what a buyer on a screen that size gets, and stays readable. */
const PHONE_BUY_BOX_WIDTH = 358;

/** The page's default look, because a product can sit on several storefronts. */
const THEME = DEFAULT_STOREFRONT_CONFIG.theme;
const INK = resolveInk(THEME, DEFAULT_PRODUCT_PAGE_CONFIG);
const RULE = ruleColor(INK);
const RADIUS = surfaceRadius(THEME.cornerRadius);
const CTA = resolveCta(DEFAULT_PRODUCT_PAGE_CONFIG, THEME);

/** Nothing is taken in a preview: a buyer meets every product with its "+". */
const NO_PICKS = [] as const;

/** The empty preview's one movement: the "+" becomes a check and back. */
const TAP = [
  { added: false, ms: 1200 },
  { added: true, ms: 1200 },
] as const;
/** Twice through, under five seconds, so it needs no pause button of its own. */
const TAP_LOOPS = 2;
/** How much of it must be on screen before it starts: the section is far down a long form. */
const IN_VIEW = { amount: 0.4 } as const;
/** How many grey rows stand in for the products not chosen yet. */
const GHOST_ROWS = [0, 1] as const;

/**
 * WHAT BUYERS WILL SEE, as they would see it: the REAL section and buy button,
 * laid out at the buy box's real width and scaled down to the column. It is a
 * picture, so it cannot be pressed or reached (`inert`), and sits on its own
 * recessed tray under its own caption, apart from the list that does the work.
 *
 * Hand it what a buyer would be offered, and what was chosen but would not be
 * (drawn faded with the reason, as the storefront editor draws it; see
 * AddOnsField). With nothing chosen, grey rows hold the place and show what a
 * press does.
 */
export function AddOnsPreview({
  cards,
  hidden,
  ownBuyLink,
}: {
  /** The chosen products a buyer would be offered, in order. */
  cards: readonly AddOnCard[];
  /** Chosen products a buyer would not be offered right now. */
  hidden: readonly HiddenAddOn[];
  /** Buy now goes to the seller's own link, and that page shows no add-ons. */
  ownBuyLink: boolean;
}) {
  const t = useTranslations("Products.addOnsField");
  const chosen = cards.length + hidden.length > 0;

  return (
    <div
      className="min-w-0 space-y-2"
      data-add-ons-preview={ownBuyLink ? "off" : chosen ? "chosen" : "empty"}
      data-add-ons-preview-hidden={hidden.length}
    >
      <p className={cn(labelClass, "flex items-center gap-1.5")}>
        <Eye className="size-4 text-muted-foreground" aria-hidden="true" />
        {t("previewLabel")}
      </p>
      <div className="bg-muted p-3">
        {ownBuyLink ? (
          <p className={helpTextClass} data-add-ons-preview-own-link="">
            {t("ownBuyLink")}
          </p>
        ) : (
          <ScaledPage cards={cards} hidden={hidden} />
        )}
      </div>
    </div>
  );
}

/** The buyer's page, shrunk to its column. Its own component because the sizes
 *  are measured once, on mount: it must come and go with the nodes it measures. */
function ScaledPage({ cards, hidden }: { cards: readonly AddOnCard[]; hidden: readonly HiddenAddOn[] }) {
  const tBuy = useTranslations("Products.buyButton");
  const { ref: boxRef, size: box } = useNaturalSize<HTMLDivElement>();
  const { ref: pageRef, size: page } = useNaturalSize<HTMLDivElement>();
  const pageWidth = box.width < PHONE_BUY_BOX_WIDTH ? PHONE_BUY_BOX_WIDTH : BUY_BOX_WIDTH;
  const scale = Math.min(1, box.width / pageWidth);

  return (
    <div
      ref={boxRef}
      className={cn("overflow-hidden", box.width === 0 && "invisible")}
      style={{ height: page.height * scale }}
    >
      <div
        ref={pageRef}
        inert
        aria-hidden="true"
        className={cn(
          "add-ons-preview-page flex origin-top-left select-none flex-col gap-4 p-5 wrap-anywhere",
          fontPresentation(THEME.font).className,
        )}
        style={{
          width: pageWidth,
          transform: `scale(${scale})`,
          background: LIGHT_INK,
          color: INK,
        }}
      >
        {cards.length + hidden.length > 0 ? (
          <AddOnsProvider offered={cards} initialPicks={NO_PICKS} syncUrl={false}>
            <AddOnsSection ink={INK} rule={RULE} radius={RADIUS} preview={false} hidden={hidden} />
          </AddOnsProvider>
        ) : (
          <GhostSection />
        )}
        <span className={CTA_BUTTON_CLASS} style={ctaStyle(CTA)}>
          {tBuy("snippetText")}
          <ArrowRight className="size-4" strokeWidth={2.25} aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}

/** The section before anything is chosen, at the size of the real one. */
function GhostSection() {
  const t = useTranslations("ProductPage.addOns");
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, IN_VIEW);
  const { beat } = useStoryBeats(TAP, TAP_LOOPS, inView);

  return (
    <div ref={ref} className="flex flex-col gap-2" data-add-ons-preview-ghost="">
      <p className="text-base font-semibold">{t("title")}</p>
      {GHOST_ROWS.map((row) => {
        const added = row === 0 && beat.added;
        return (
          <div
            key={row}
            className="flex items-center gap-3 border p-2"
            style={addOnFrameStyle(added, INK, RULE, RADIUS)}
            data-add-ons-preview-ghost-row={added ? "added" : "offered"}
          >
            <span
              className="size-14 shrink-0"
              style={{ borderRadius: addOnInnerRadius(RADIUS), background: subtleFill(INK) }}
            />
            <span className="flex min-w-0 flex-1 flex-col gap-2">
              <span className={cn(placeholderBarClass, "w-3/5")} />
              <span className={cn(placeholderBarClass, "w-1/4")} />
            </span>
            <AddOnAddButton added={added} ink={INK} rule={RULE} radius={RADIUS} />
          </div>
        );
      })}
    </div>
  );
}
