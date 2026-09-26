"use client";

import { Globe, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { badgeClass, cardClass } from "@/components/ui/surface-styles";
import type { Product } from "@/types/product";
import { buyerVisibleBlocks, type StorefrontConfig } from "@/types/storefront";
import { StorefrontPreview } from "./StorefrontPreview";

/** A greyed bar standing in for a line of the host page's own content. */
const PLACEHOLDER_BAR = "h-2 rounded-full bg-border";

/** Four tiles standing in for the products of a storefront that has none yet. */
const STAND_IN_TILES = [0, 1, 2, 3] as const;

/**
 * The picture of what this page does: the seller's real storefront sitting in a
 * slot on someone else's website. It answers the settings below it live: dim
 * and locked until embedding is on with at least one domain, then lit, with the
 * first allowed domain in the address bar.
 *
 * Purely illustrative, so the whole thing is `aria-hidden`; the switch and the
 * domain field under it carry the meaning in words.
 */
export function EmbedHero({
  config,
  productsById,
  domain,
  live,
}: {
  config: StorefrontConfig;
  productsById: ReadonlyMap<string, Product>;
  /** First allowed domain, shown in the address bar. */
  domain: string | undefined;
  /** Embedding on AND at least one domain: the state where the snippet works. */
  live: boolean;
}) {
  const t = useTranslations("Storefront.embed");
  // A storefront with nothing on it would leave the slot blank, and a blank slot
  // does not say "your shop goes here". Stand-in tiles do.
  const isEmpty = buyerVisibleBlocks(config).length === 0;
  return (
    <div aria-hidden="true" className={cn(cardClass, "overflow-hidden")}>
      {/* Browser chrome. */}
      <div className="flex items-center gap-3 border-b border-border bg-secondary px-3 py-2">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full bg-background px-3 py-1 font-inter text-xs text-muted-foreground">
          <Globe className="size-3 shrink-0" strokeWidth={2} />
          {domain ? (
            <span className="truncate text-foreground">{domain}</span>
          ) : (
            <span className={cn(PLACEHOLDER_BAR, "w-24")} />
          )}
        </div>
      </div>

      {/* The host page: a few stand-in lines around the embed slot. */}
      <div className="space-y-4 bg-muted/40 px-6 py-6">
        <div className="space-y-2">
          <span className={cn(PLACEHOLDER_BAR, "block w-1/3")} />
          <span className={cn(PLACEHOLDER_BAR, "block w-2/3")} />
        </div>

        <div
          className={cn(
            "relative mx-auto aspect-[4/3] w-3/5 rounded-sm border border-dashed transition-colors duration-slow ease-standard motion-reduce:transition-none",
            live ? "border-success bg-background" : "border-border bg-background/60",
          )}
        >
          <div
            className={cn(
              "absolute inset-0 overflow-hidden rounded-sm transition-[opacity,filter] duration-slow ease-standard motion-reduce:transition-none",
              live ? "opacity-100" : "opacity-40 grayscale",
            )}
          >
            {isEmpty ? (
              <div className="grid size-full grid-cols-2 gap-2 p-3">
                {STAND_IN_TILES.map((tile) => (
                  <span key={tile} className="rounded-sm bg-secondary" />
                ))}
              </div>
            ) : (
              <StorefrontPreview config={config} productsById={productsById} textless />
            )}
          </div>
          {live ? (
            <span
              className={cn(
                badgeClass,
                "absolute left-3 top-0 flex -translate-y-1/2 items-center gap-1.5 border border-border bg-background text-foreground shadow-xs",
              )}
            >
              <span className="size-1.5 rounded-full bg-success" />
              {t("enabledLabel")}
            </span>
          ) : (
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex size-10 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-xs">
                <Lock className="size-4" strokeWidth={2} />
              </span>
            </span>
          )}
        </div>

        <div className="space-y-2">
          <span className={cn(PLACEHOLDER_BAR, "block w-1/2")} />
          <span className={cn(PLACEHOLDER_BAR, "block w-1/4")} />
        </div>
      </div>
    </div>
  );
}
