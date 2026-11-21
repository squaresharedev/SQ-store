"use client";

import { PoweredByFooter } from "@/components/product-page/PoweredByFooter";
import { chipStyle, ruleColor } from "@/components/product-page/product-page-maps";
import { StorefrontCart } from "@/components/cart/StorefrontCart";
import { CartButton } from "@/components/cart/CartButton";
import { CustomFontFace } from "@/components/storefront/CustomFontFace";
import { storefrontDisplayName } from "@/lib/storefront/display-name";
import { cn } from "@/lib/utils";
import type { StorefrontPageData } from "@/types/storefront-page";
import { StorefrontBoard, storefrontSurface } from "./StorefrontBoard";

/**
 * A HOSTED STOREFRONT, as a buyer sees it: the board the seller designed, on
 * a page of its own (/s/[storefrontId]).
 *
 * The board itself is StorefrontBoard, the one drawing shared with the embed
 * frame. What this adds is only what a page of its own needs: it fills the
 * screen, and it closes with the footer every hosted page carries (who the
 * seller is, and how to report the storefront).
 */
export function StorefrontPageView({
  page,
  assumedWidth,
}: {
  page: StorefrontPageData;
  /** See StorefrontBoard: the board width to render for before measuring. */
  assumedWidth?: number;
}) {
  const { theme } = page;
  const surface = storefrontSurface(page);
  const displayName = storefrontDisplayName(page);
  const soldBy = page.seller.businessName || page.name;
  const cart = page.cart ?? null;

  return (
    <StorefrontCart
      storefrontId={page.id}
      cart={cart}
      // The cart wears the shop: its ink, its corners, its buy button.
      theme={{ ink: surface.ink, cornerRadius: theme.cornerRadius, cta: page.tileLook.buy }}
    >
    <div
      className={cn("@container relative isolate flex min-h-screen w-full flex-col", surface.className)}
      style={surface.style}
      data-storefront-page={page.id}
      data-page-ink={surface.ink}
    >
      <CustomFontFace customFont={theme.customFont} url={page.customFontUrl} />
      {/* The page's own heading, whether or not the seller shows a masthead:
          the masthead is a design choice, a name for the page is not. */}
      <h1 className="sr-only">{displayName}</h1>
      {cart && (
        // In view while the board scrolls, on the shop's own translucent
        // chip fill so it reads over any backdrop. The row passes clicks
        // through everywhere but the button.
        <div className="pointer-events-none sticky top-0 z-20 flex justify-end px-4 pt-3 @md:px-6 @3xl:px-10">
          <span className="pointer-events-auto" style={chipStyle(surface.ink, theme.cornerRadius)}>
            <CartButton ink={surface.ink} />
          </span>
        </div>
      )}
      <main className="mx-auto w-full max-w-[76rem] flex-1 px-4 py-6 @md:px-6 @3xl:px-10">
        <StorefrontBoard page={page} displayName={displayName} assumedWidth={assumedWidth} />
      </main>
      <PoweredByFooter
        ruleColor={ruleColor(surface.ink)}
        sellerName={soldBy}
        storefront={{ id: page.id, name: displayName }}
      />
    </div>
    </StorefrontCart>
  );
}
