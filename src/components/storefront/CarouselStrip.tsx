"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Product } from "@/types/product";
import {
  blockCornerRadius,
  blockKey,
  readingOrder,
  type StorefrontBlock,
  type StorefrontTheme,
  type TextSpan,
} from "@/types/storefront";
import { cn } from "@/lib/utils";
import {
  BlockTile,
  TILE_CONTROL_CHIP_CLASS,
  TILE_CONTROL_CLASS,
} from "./BlockTile";
import type {
  InlineFormatKey,
  TextEditSource,
  TextRange,
} from "./InlineTextEditor";

/** Sub-pixel slack when comparing scrollLeft against its bounds — fractional
 *  layout widths mean an end-stopped strip rarely lands on an exact integer. */
const SCROLL_EPSILON = 1;

/** Floating prev/next control: a round chip pinned to the strip's edge. Sized
 *  for a thumb (touch targets), and tinted with the app tokens the rest of the
 *  tile chrome uses so it stays legible on any storefront background. */
const NAV_BUTTON_CLASS =
  "absolute top-1/2 z-30 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/90 text-foreground shadow-sm backdrop-blur-sm transition-colors duration-base ease-standard hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none";

/**
 * The `carousel` display mode's renderer: a horizontal scroll-snap strip of
 * uniform square tiles, shared by the designer canvas (editable — the on-tile
 * arrows reorder; block SIZES only apply in grid mode) and the static card
 * preview (`compact`). The gap tracks the same `--grid-gap` custom property as
 * the grid, so the density setting applies to both modes.
 *
 * Buyers can swipe, but swiping is invisible: whenever the strip actually
 * overflows its container (which is exactly the mobile/narrow case), edge
 * arrows step it one product at a time — bringing that product to the center
 * of the strip — so the off-screen content announces itself. Each arrow
 * disappears at its end of the track, so the presence of an arrow always
 * means "there is more this way".
 */
export function CarouselStrip({
  blocks,
  getProduct,
  theme,
  editable = false,
  editingKeys = [],
  typingKey = null,
  typingSelectAll = false,
  onSelect,
  onRemove,
  onMove,
  onTypeStart,
  onTextChange,
  onToggleBlockFormat,
  onTextRangeChange,
  onTypeEnd,
  compact = false,
}: {
  /** In visual order; the caller applies any hide-sold-out filtering. */
  blocks: StorefrontBlock[];
  getProduct: (block: StorefrontBlock) => Product | null;
  theme: StorefrontTheme;
  editable?: boolean;
  /** Keys of the blocks open in the inspector panel (editable mode only). */
  editingKeys?: readonly string[];
  /** The text block whose words are being typed on the tile, if any. */
  typingKey?: string | null;
  typingSelectAll?: boolean;
  /** Toggle semantics live with the selection's owner; `additive` is a
   *  shift-click (add/remove instead of replace). */
  onSelect?: (key: string | null, additive?: boolean) => void;
  onRemove?: (key: string) => void;
  /** Move a block one slot left (-1) or right (1). */
  onMove?: (key: string, direction: -1 | 1) => void;
  /** Text blocks: start / apply / end typing on the tile. */
  onTypeStart?: (key: string) => void;
  onTextChange?: (key: string, text: string, spans: TextSpan[], source: TextEditSource) => void;
  onToggleBlockFormat?: (key: string, format: InlineFormatKey) => void;
  onTextRangeChange?: (range: TextRange | null) => void;
  onTypeEnd?: () => void;
  compact?: boolean;
}) {
  const stripRef = useRef<HTMLUListElement>(null);
  // Both false until measured: the arrows only appear once we know the strip
  // overflows, so a fully-visible row never grows chrome it doesn't need.
  const [nav, setNav] = useState({ prev: false, next: false });

  // The thumbnail preview (compact) is far too small to host controls.
  const showNav = !compact;

  const syncNav = useCallback(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const max = strip.scrollWidth - strip.clientWidth;
    setNav(
      max <= SCROLL_EPSILON
        ? { prev: false, next: false }
        : {
            prev: strip.scrollLeft > SCROLL_EPSILON,
            next: strip.scrollLeft < max - SCROLL_EPSILON,
          },
    );
  }, []);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || !showNav) return;

    syncNav();
    strip.addEventListener("scroll", syncNav, { passive: true });
    // Container resizes (the designer's desktop/mobile toggle, a real device
    // rotating) change what fits without firing a scroll event.
    const observer = new ResizeObserver(syncNav);
    observer.observe(strip);
    return () => {
      strip.removeEventListener("scroll", syncNav);
      observer.disconnect();
    };
    // blocks.length: adding/removing tiles changes scrollWidth, which no
    // observer on the strip itself reports.
  }, [showNav, syncNav, blocks.length]);

  /**
   * Step to the neighbouring product and CENTER it. Everything is measured off
   * live bounding rects (never offsetLeft, whose offsetParent here is the
   * wrapper rather than the scroller) so the maths holds regardless of gap,
   * tile width, or where a swipe left the strip mid-tile.
   *
   * The current tile is whichever one sits closest to the strip's center, so a
   * press always advances exactly one product from what the buyer is looking
   * at. The browser clamps the resulting scroll at both ends — the first and
   * last tiles simply rest against their edge instead of centering, which is
   * also where their arrow disappears.
   */
  function scrollToNeighbor(direction: -1 | 1) {
    const strip = stripRef.current;
    if (!strip) return;
    const items = Array.from(strip.children) as HTMLElement[];
    if (items.length === 0) return;

    const stripRect = strip.getBoundingClientRect();
    const center = stripRect.left + stripRect.width / 2;
    const centerOf = (item: HTMLElement) => {
      const rect = item.getBoundingClientRect();
      return rect.left + rect.width / 2;
    };

    let current = 0;
    let closest = Number.POSITIVE_INFINITY;
    items.forEach((item, index) => {
      const distance = Math.abs(centerOf(item) - center);
      if (distance < closest) {
        closest = distance;
        current = index;
      }
    });

    const target =
      items[Math.min(Math.max(current + direction, 0), items.length - 1)];
    strip.scrollBy({
      left: centerOf(target) - center,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }

  return (
    <div className="relative">
      <ul
        ref={stripRef}
        aria-label="Storefront carousel"
        className="m-0 flex list-none snap-x snap-mandatory overflow-x-auto p-0"
        // The shared bento gap token (density override included) — code-defined.
        style={{ gap: "var(--grid-gap)" }}
      >
        {readingOrder(blocks).map((block, index, ordered) => {
          const key = blockKey(block);
          return (
            <li
              key={key}
              // Product tiles may override the theme's roundness (block.style).
              style={{ borderRadius: blockCornerRadius(theme, block) }}
              className={cn(
                // No overflow clip: BlockTile's face wrapper clips content to
                // the radius, so the tile controls survive round corners.
                "group relative aspect-square shrink-0",
                // Center alignment is what makes an arrow press land cleanly:
                // mandatory snapping would otherwise drag a centered tile back
                // to a start-aligned point the moment the smooth scroll ends.
                // Swipes get the same treatment, so both gestures agree. The
                // static thumbnail keeps start alignment (it never scrolls).
                compact ? "w-24 snap-start" : "w-40 snap-center sm:w-48",
              )}
            >
              <BlockTile
                blockKey={key}
                block={block}
                product={getProduct(block)}
                theme={theme}
                editable={editable}
                isEditing={editingKeys.includes(key)}
                isSoleSelection={
                  editingKeys.length === 1 && editingKeys[0] === key
                }
                isTyping={typingKey === key}
                typingSelectAll={typingSelectAll}
                onToggleEdit={onSelect}
                onRemove={onRemove}
                onTypeStart={onTypeStart}
                onTextChange={onTextChange}
                onToggleBlockFormat={onToggleBlockFormat}
                onTextRangeChange={onTextRangeChange}
                onTypeEnd={onTypeEnd}
              />

              {/* Reorder arrows (the grid's drag handle has no meaning here). */}
              {editable && onMove && (
                <div className={cn(TILE_CONTROL_CHIP_CLASS, "left-1 top-1")}>
                  <button
                    type="button"
                    onClick={() => onMove(key, -1)}
                    disabled={index === 0}
                    aria-label="Move block left"
                    className={TILE_CONTROL_CLASS}
                  >
                    <ChevronLeft
                      className="size-3.5"
                      strokeWidth={2}
                      aria-hidden="true"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMove(key, 1)}
                    disabled={index === ordered.length - 1}
                    aria-label="Move block right"
                    className={TILE_CONTROL_CLASS}
                  >
                    <ChevronRight
                      className="size-3.5"
                      strokeWidth={2}
                      aria-hidden="true"
                    />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {showNav && nav.prev && (
        <button
          type="button"
          onClick={() => scrollToNeighbor(-1)}
          aria-label="Show previous items"
          className={cn(NAV_BUTTON_CLASS, "left-1.5")}
        >
          <ChevronLeft className="size-5" strokeWidth={2} aria-hidden="true" />
        </button>
      )}
      {showNav && nav.next && (
        <button
          type="button"
          onClick={() => scrollToNeighbor(1)}
          aria-label="Show more items"
          className={cn(NAV_BUTTON_CLASS, "right-1.5")}
        >
          <ChevronRight className="size-5" strokeWidth={2} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
