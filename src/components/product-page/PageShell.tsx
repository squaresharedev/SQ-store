import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { resolveBackgroundStyle } from "@/components/storefront/background-presets";
import { CustomFontFace } from "@/components/storefront/CustomFontFace";
import { customFontVars, fontPresentation } from "@/lib/theme/storefront-fonts";
import type { ProductPageStorefront } from "@/types/product-page";
import type { StorefrontFont } from "@/types/storefront";
import { ruleColor } from "./product-page-maps";

/**
 * THE FRAME EVERY HOSTED PAGE SITS IN: the product page, the checkout and the
 * thank-you page. The backdrop, the ink, the typeface, the store's own bar
 * along the top and the footer slot along the bottom, decided once, so the
 * three pages read as one shop rather than three templates that happen to
 * share colours.
 *
 * Server-compatible and prop-driven, like the pages inside it. The caller has
 * already resolved which backdrop and which font apply (each page inherits
 * from the one before it, which inherits from the storefront); this paints
 * what it is handed.
 *
 * The root is an `@container`, so every page inside it lays out by its OWN
 * width: the editor's phone-width artboard stacks exactly as a phone does.
 */
export function PageShell({
  storefront,
  backgroundColor,
  surfaceLayers,
  font,
  ink,
  preview,
  padForStickyBar = false,
  rootAttributes,
  headerAside,
  footer,
  children,
}: {
  storefront: Pick<
    ProductPageStorefront,
    "name" | "header" | "theme" | "backgroundImageUrl" | "customFontUrl"
  >;
  /** The page's own solid backdrop. Absent = the storefront's background, whole
   *  (a gradient or photograph included). A colour REPLACES that background
   *  rather than tinting it. */
  backgroundColor?: string;
  /** Extra background layers over `backgroundColor` (the checkout's texture).
   *  Ignored without it: a pattern belongs on a solid surface, never over a
   *  storefront's gradient or photograph. */
  surfaceLayers?: CSSProperties;
  /** The page's typeface; absent = the storefront's. */
  font?: StorefrontFont;
  /** Whichever ink reads on the backdrop (resolveInk). */
  ink: string;
  preview: boolean;
  /** Room at the foot for a mobile sticky bar, so it never covers the footer. */
  padForStickyBar?: boolean;
  /** `data-*` attributes the page publishes on its root, for tests and agents. */
  rootAttributes?: Record<`data-${string}`, string>;
  /** Something small at the far end of the store's bar ("Secure checkout"). */
  headerAside?: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  const { theme } = storefront;
  const presentation = fontPresentation(font ?? theme.font);
  const storeName =
    storefront.header?.show && storefront.header.name ? storefront.header.name : storefront.name;

  const rootStyle: CSSProperties = {
    ...(backgroundColor
      ? { backgroundColor, ...surfaceLayers }
      : resolveBackgroundStyle(theme.background, storefront.backgroundImageUrl)),
    ...customFontVars(theme.customFont, storefront.customFontUrl),
    color: ink,
    ...presentation.style,
  };

  return (
    <>
      <CustomFontFace customFont={theme.customFont} url={storefront.customFontUrl} />
      <div
        className={cn(
          "@container flex w-full flex-col",
          presentation.className,
          preview ? "min-h-full" : "min-h-screen",
          padForStickyBar && "pb-24 @3xl:pb-0",
        )}
        style={rootStyle}
        // Outermost hotspot, so it is what a click on the page's own backdrop
        // finds. Every region inside names its own and wins by being nearer.
        data-setting-hotspot="background"
        // The page's own boundary, for anything inside that has to find its
        // way around THIS page only (the sticky bar's watch), when the editor
        // draws several pages side by side.
        data-page-root=""
        {...rootAttributes}
      >
        {/* The store's own line above the page. A full-width bar rather than a
            caption: it is the one piece of chrome that says whose shop this
            is, and on a full screen it belongs at the top edge. */}
        <header
          className="w-full border-b"
          style={{ borderColor: ruleColor(ink) }}
          data-product-page-header=""
          data-setting-hotspot="header"
        >
          <div className="mx-auto flex w-full max-w-[76rem] items-center gap-4 px-4 py-3 @md:px-6 @3xl:px-10">
            <p className="min-w-0 flex-1 truncate text-sm font-medium">{storeName}</p>
            {headerAside}
          </div>
        </header>
        <div className="flex-1">{children}</div>
        {footer}
      </div>
    </>
  );
}
