"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Code2, ExternalLink, Link2, Sparkles, TrendingUp, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { CopyButton } from "@/components/ui/CopyButton";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Select } from "@/components/ui/select";
import { SellerDetailsNotice } from "@/components/settings/SellerDetailsNotice";
import { cardClass, codeSurfaceClass } from "@/components/ui/surface-styles";
import {
  bannerActionClass,
  focusRingClass,
  helpTextClass,
  iconNudgeRightClass,
  infoTextClass,
  labelClass,
  quietLinkClass,
} from "@/components/ui/control-styles";
import { buyButtonPrompt, buyButtonSnippet } from "@/lib/storefront/embed-snippet";
import { productPageUrl } from "@/lib/storefront/product-page-url";
import { productEditPath } from "@/lib/products/paths";
import { STOREFRONT_LIST_PATH } from "@/lib/storefront/paths";
import type { StorefrontPlacement } from "@/lib/products/queries";
import type { TraderIdentityField } from "@/lib/settings/trader-identity";
import type { Product } from "@/types/product";
import { BuyButtonStory } from "./BuyButtonStory";

/** What the dialog says, in order of precedence: the first that applies wins. */
export type BuyButtonState = "removed" | "sellerDetails" | "draft" | "notPlaced" | "ready";

/**
 * Whether a buy button for this product would lead anywhere and, if not, the
 * first reason why. It asks the hosted page's own questions
 * (lib/products/purchasable.ts) of what the dashboard already holds, so the
 * dialog never hands out a link the page would 404: the embed page's rule
 * (never offer a snippet that cannot work) applied to one product.
 */
export function buyButtonState(
  product: Pick<Product, "status" | "removal">,
  /** Storefronts the product is on WITH product pages switched on. */
  storefronts: readonly StorefrontPlacement[],
  missingTraderDetails: readonly TraderIdentityField[],
): BuyButtonState {
  if (product.removal) return "removed";
  if (missingTraderDetails.length > 0) return "sellerDetails";
  if (product.status !== "active") return "draft";
  if (storefronts.length === 0) return "notPlaced";
  return "ready";
}

/** The ways to get the link onto a site, simplest first: paste a link (no
 *  code at all), paste one line of HTML, or hand the job to an AI agent. */
const METHODS = [
  { id: "link", icon: Link2 },
  { id: "html", icon: Code2 },
  { id: "agent", icon: Sparkles },
] as const satisfies readonly { id: string; icon: LucideIcon }[];
type Method = (typeof METHODS)[number]["id"];

/**
 * "Add to your website": a buy button for ONE product, for a seller who would
 * rather put their own button on their own site than embed a whole storefront.
 * (Not the product page's own buy button, which the designer styles: this one
 * lives on the seller's site and points here.)
 *
 * The button is nothing but a link: the product's hosted page with
 * `?via=button`, which files the visit, and any sale it leads to, under the
 * "Website button" channel. No script, so it works in any site builder's
 * button-link field, and nothing of ours runs on the seller's page. The page
 * design comes from a storefront the product is placed on, because that is
 * where the page and checkout are designed; with more than one, the seller
 * picks which.
 *
 * BUILT TO BE SCANNED. One motion graphic shows what it does (BuyButtonStory),
 * and exactly ONE thing to copy is on screen at a time: the seller picks how they will add it (link,
 * HTML, or a prompt for an AI agent) and gets that, a Copy button and one line
 * of where it goes. A blocked product gets the reason and its fix instead.
 *
 * Read-only, so every role may open it; only the fix that edits the product
 * needs `canWrite`.
 */
export function BuyButtonDialog({
  product,
  placements,
  canWrite,
  missingTraderDetails,
  onClose,
}: {
  product: Product;
  /** Every storefront the product is placed on (getProductPlacements). */
  placements: readonly StorefrontPlacement[];
  canWrite: boolean;
  /** Trader details the store still owes buyers; non-empty blocks the page. */
  missingTraderDetails: readonly TraderIdentityField[];
  onClose: () => void;
}) {
  const t = useTranslations("Products.buyButton");
  // A storefront with product pages switched off has no page to link to.
  const storefronts = placements.filter((placement) => placement.productPagesOn !== false);
  const [chosenId, setChosenId] = useState(storefronts[0]?.id ?? "");
  const [method, setMethod] = useState<Method>("link");
  const storefront = storefronts.find((candidate) => candidate.id === chosenId) ?? storefronts[0];
  const state = buyButtonState(product, storefronts, missingTraderDetails);
  const url = state === "ready" && storefront ? productPageUrl(storefront.id, product.id, { via: "button" }) : null;

  const fix = (href: string, label: string) => (
    <Link href={href} className={bannerActionClass}>
      {label}
      <ArrowRight className={cn("size-3.5", iconNudgeRightClass)} strokeWidth={2} aria-hidden />
    </Link>
  );
  const blocked: Partial<Record<BuyButtonState, { message: string; action: ReactNode }>> = {
    removed: { message: t("blocked.removed"), action: canWrite && fix(productEditPath(product.id), t("editProduct")) },
    draft: { message: t("blocked.draft"), action: canWrite && fix(productEditPath(product.id), t("editProduct")) },
    notPlaced: { message: t("blocked.notPlaced"), action: fix(STOREFRONT_LIST_PATH, t("goToStorefronts")) },
  };
  const note = blocked[state];

  // What each method copies. The prompt is assembled from catalogue sentences
  // and these two machine-made values only (see buyButtonPrompt).
  const snippet = url ? buyButtonSnippet(url, t("snippetText")) : "";
  const copies: Record<Method, string> = {
    link: url ?? "",
    html: snippet,
    agent: buyButtonPrompt(url ?? "", snippet, {
      task: t("prompt.task"),
      html: t("prompt.html"),
      rules: [t("prompt.style"), t("prompt.normal"), t("prompt.exact")],
    }),
  };

  return (
    // Focus lands on the dialog, not its first control: that is the story's
    // pause button, which a stray Space or Enter would act on.
    <Modal open onClose={onClose} title={t("title")} initialFocus="dialog">
      <div className="space-y-5" data-buy-button-state={state} data-buy-button-url={url ?? undefined}>
        <p className="sr-only">{t("summary", { title: product.title })}</p>
        <BuyButtonStory product={product} live={state === "ready"} pageHost={url ? new URL(url).host : undefined} />

        {state === "sellerDetails" && <SellerDetailsNotice missing={missingTraderDetails} detailed={false} />}

        {note && (
          <div role="note" className={cn(cardClass, "flex flex-col items-start gap-3 p-4")}>
            <p className={helpTextClass}>{note.message}</p>
            {note.action}
          </div>
        )}

        {url && storefront && (
          <>
            {storefronts.length > 1 && (
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="buy-button-storefront" className={labelClass}>
                  {t("storefrontLabel")}
                </label>
                <div className="w-48">
                  <Select
                    id="buy-button-storefront"
                    value={storefront.id}
                    options={storefronts.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
                    onChange={setChosenId}
                    align="right"
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <SegmentedControl
                ariaLabel={t("methods")}
                value={method}
                onChange={setMethod}
                options={METHODS.map(({ id, icon: Icon }) => ({
                  value: id,
                  label: (
                    <>
                      <Icon className="size-3.5" strokeWidth={2} aria-hidden="true" />
                      {t(`method.${id}`)}
                    </>
                  ),
                }))}
              />
              <div className={cn(codeSurfaceClass, "flex items-start gap-2 p-3")}>
                {/* A read-only text box: the one thing to copy. It scrolls
                    rather than grows when it holds the agent's prompt, and
                    takes focus so that scroll is reachable from the keyboard. */}
                <pre
                  role="textbox"
                  aria-readonly="true"
                  aria-multiline="true"
                  aria-label={t(`method.${method}`)}
                  tabIndex={0}
                  data-buy-button-copy={method}
                  className={cn(
                    "max-h-36 min-w-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words py-1.5 font-mono text-xs leading-relaxed",
                    focusRingClass,
                  )}
                >
                  {copies[method]}
                </pre>
                <CopyButton
                  value={copies[method]}
                  variant="labelled"
                  messages={{
                    copy: `Products.buyButton.copy.${method}.copy`,
                    copied: `Products.buyButton.copy.${method}.copied`,
                    failed: `Products.buyButton.copy.${method}.failed`,
                  }}
                />
              </div>
              <p className={infoTextClass}>{t(`hint.${method}`)}</p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border pt-4">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(quietLinkClass, "inline-flex items-center gap-1.5")}
              >
                {t("tryIt")}
                <ExternalLink className="size-3.5" strokeWidth={2} aria-hidden />
              </a>
              <p className={cn(infoTextClass, "inline-flex items-center gap-1.5")}>
                <TrendingUp className="size-3.5" strokeWidth={2} aria-hidden />
                {t("tracking")}
              </p>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
