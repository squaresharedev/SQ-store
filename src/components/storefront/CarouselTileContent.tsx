"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, GalleryHorizontalEnd } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { transitionClass } from "@/components/ui/control-styles";
import type { TileLook } from "@/lib/storefront/tile-look";
import type { Product } from "@/types/product";
import type { CarouselBlock, StorefrontTheme } from "@/types/storefront";
import { TILE_FACE_CLASS, tileFrameClass } from "./config-maps";
import { ProductTileContent, type TileQuickAddAction } from "./ProductTileContent";

/**
 * How a carousel's card leads to its product on a buyer's board: the board
 * draws the link (or the card that adds to the cart) exactly as it does for a
 * product block, around the face it is handed. Null when the board has no
 * page for that product.
 */
export type CarouselCardLink = (
  productId: string,
  frameClassName: string,
  renderFace: (action?: TileQuickAddAction) => ReactNode,
) => ReactNode;

/**
 * What a carousel's cards are drawn from, handed in by whoever draws the
 * board: the designer and the previews from the seller's catalogue, a buyer's
 * board from the products its payload carries (only what a buyer may see).
 */
export type CarouselCards = {
  /** The product a card shows, or null for one this board does not draw (not
   *  live, deleted, someone else's): that card is left out. */
  product: (productId: string) => Product | null;
  /** A buyer's board: how a card opens its product. Absent (the designer, the
   *  previews), a card leads nowhere. */
  link?: CarouselCardLink;
};

/** A card's frame: a product card's own (border, card colour), filling its
 *  slot. Its corners come from the slot. */
const CARD_FRAME_CLASS = tileFrameClass({ type: "product" });

/**
 * THE TRACK: one row that scrolls sideways, snapping each card to its start.
 * Native CSS scroll snap and nothing else (no library, no autoplay): a finger
 * swipes it, a trackpad scrolls it, and focusing a card scrolls it into view.
 * `swipe-x` (globals.css) draws no scrollbar and keeps a swipe past the end
 * from scrolling the page. The cards sit the board's own gap apart, so a row
 * as wide as three of its cards lines up with the board's columns.
 */
const TRACK_CLASS = "swipe-x flex h-full w-full snap-x snap-mandatory gap-(--grid-gap) overflow-x-auto";

/**
 * ONE CARD'S SLOT: as wide as the row is tall (a square card, like a product
 * card as tall as the row), never wider than the row. The face below is the
 * size container these units are read against. Its corners are the cell's
 * (--tile-radius, published by tileClipStyle): the board's roundness at the
 * row's height, the same a product card of that height wears.
 */
const CARD_SLOT_CLASS = "relative h-full w-[min(100cqh,100cqw)] flex-none snap-start rounded-(--tile-radius)";

/**
 * THE ARROWS, a desktop's way along the row (a phone swipes, and never sees
 * them: `pointer-fine`). The card's own surface with the dark ink a card's
 * name wears, which reads over any photo and any board, with a two-tone focus
 * ring (dark round a pale gap) that shows on either. At an end the arrow stays
 * where it is, focusable, its arrow faded, rather than vanishing from under a
 * keyboard's focus.
 */
const ARROW_CLASS = cn(
  "absolute top-1/2 z-10 hidden size-9 -translate-y-1/2 items-center justify-center rounded-full pointer-fine:flex",
  "bg-card/90 text-foreground shadow-md hover:bg-card",
  transitionClass,
  "outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-card",
  // At an end only the arrow fades: a focus ring on it stays at full strength.
  "aria-disabled:cursor-default aria-disabled:bg-card/60 aria-disabled:*:opacity-40",
);

/** A card link's focus ring, drawn OVER the face (a ring on the link itself
 *  would sit under the photo): the board's ink, inside a line of the card's
 *  own pale surface, so it shows on a dark photo and a pale one alike. */
const CARD_FOCUS_RING_CLASS =
  "pointer-events-none absolute inset-0 z-20 rounded-[inherit] opacity-0 ring-2 ring-inset ring-current outline-2 -outline-offset-4 outline-card group-focus-visible/card:opacity-100";

/** Whether this reader asked for less motion: the arrows then jump. */
function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * The face of a PRODUCT CAROUSEL: a row of product cards wearing the board's
 * card look (the theme's card style through ProductTileContent, the same face
 * a product block draws), swiped on a phone and stepped with arrows on a
 * desktop.
 *
 * Cards hold still on hover: the board's hover effects answer to the CELL
 * (Grid's `group`), and a row of cards is one cell, so every card would lift
 * at once. A carousel's cards are never measured for "auto" white blend
 * either (that measurement is a product block's), so they blend only where
 * the seller turned it on.
 */
export function CarouselTileContent({
  block,
  theme,
  look,
  cards,
}: {
  block: CarouselBlock;
  theme: StorefrontTheme;
  /** What the cards borrow from the product page (resolveTileLook). */
  look?: TileLook;
  /** Where the cards come from (see CarouselCards). Absent: nothing to draw. */
  cards?: CarouselCards;
}) {
  const t = useTranslations("EditorLayout.board.carousel");
  const trackId = useId();
  const trackRef = useRef<HTMLUListElement>(null);
  // Which ends the row is at. Both at first, which draws no arrows: they come
  // in once the row is measured and found to run past its block.
  const [edges, setEdges] = useState({ start: true, end: true });

  const shown = block.productIds.flatMap((id) => {
    const product = cards?.product(id) ?? null;
    return product ? [product] : [];
  });

  useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const overflow = track.scrollWidth - track.clientWidth;
      const at = Math.abs(track.scrollLeft);
      const next = { start: at <= 1, end: at >= overflow - 1 };
      setEdges((current) => (current.start === next.start && current.end === next.end ? current : next));
    };
    // Measured when the observer first reports the row (and whenever its
    // size changes), then on every scroll.
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    track.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      track.removeEventListener("scroll", measure);
    };
  }, [shown.length]);

  if (shown.length === 0) {
    // Nothing to draw: on a buyer's board this never happens (the server
    // drops a carousel left with no product a buyer may see), so this is the
    // seller's own board, where the panel says what to do.
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-[inherit] border border-dashed border-current opacity-40">
        <GalleryHorizontalEnd className="size-6" strokeWidth={1.5} aria-hidden="true" />
      </div>
    );
  }

  /** One page along: the row's own width, then the snap lands it on a card. */
  function step(direction: 1 | -1) {
    const track = trackRef.current;
    if (!track) return;
    if ((direction === -1 && edges.start) || (direction === 1 && edges.end)) return;
    track.scrollBy?.({ left: direction * track.clientWidth, behavior: reducedMotion() ? "auto" : "smooth" });
  }

  const overflowing = !(edges.start && edges.end);

  return (
    <div
      role="region"
      aria-roledescription={t("roleDescription")}
      aria-label={t("label", { count: shown.length })}
      className="relative flex min-h-0 flex-1 [container-type:size]"
      data-carousel={block.id}
    >
      <ul id={trackId} ref={trackRef} className={TRACK_CLASS}>
        {shown.map((product) => {
          const renderFace = (action?: TileQuickAddAction) => (
            <div className={TILE_FACE_CLASS}>
              <ProductTileContent product={product} theme={theme} look={look} hover="still" quickAddAction={action} />
            </div>
          );
          const linked = cards?.link?.(product.id, CARD_FRAME_CLASS, renderFace);
          return (
            <li key={product.id} className={CARD_SLOT_CLASS} data-carousel-card={product.id}>
              {linked ?? <div className={CARD_FRAME_CLASS}>{renderFace()}</div>}
            </li>
          );
        })}
      </ul>
      {overflowing && (
        <>
          <button
            type="button"
            aria-controls={trackId}
            aria-label={t("previous")}
            aria-disabled={edges.start || undefined}
            onClick={() => step(-1)}
            className={cn(ARROW_CLASS, "left-1.5")}
            data-carousel-step="previous"
          >
            <ChevronLeft className="size-5" strokeWidth={2.25} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-controls={trackId}
            aria-label={t("next")}
            aria-disabled={edges.end || undefined}
            onClick={() => step(1)}
            className={cn(ARROW_CLASS, "right-1.5")}
            data-carousel-step="next"
          >
            <ChevronRight className="size-5" strokeWidth={2.25} aria-hidden="true" />
          </button>
        </>
      )}
    </div>
  );
}

/**
 * A carousel card that opens its product's page, on a buyer's board: the
 * card's frame as a link, and its focus ring over the face. In the embed frame
 * the page opens in a tab of its own, so the seller's site stays behind it.
 */
export function CarouselCardAnchor({
  href,
  newTab,
  productId,
  frameClassName,
  children,
}: {
  href: string;
  newTab: boolean;
  productId: string;
  frameClassName: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      // noreferrer as well as noopener: the new tab is handed neither this
      // window nor the address of the page it was on.
      {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={cn(frameClassName, "group/card block outline-none")}
      data-storefront-tile={productId}
    >
      {children}
      <span aria-hidden="true" className={CARD_FOCUS_RING_CLASS} />
    </a>
  );
}
