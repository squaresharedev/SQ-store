"use client";

import Link from "next/link";
import { Code, Trash2 } from "lucide-react";
import { cardClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";
import {
  focusRingClass,
  hoverLiftClass,
  iconButtonClass,
} from "@/components/ui/control-styles";
import { formatOrderDate } from "@/lib/format/date";
import type { Product } from "@/types/product";
import type { StorefrontSummary } from "@/lib/storefront/queries";
import { buyerVisibleBlocks } from "@/types/storefront";
import { isStrictHexColor } from "@/lib/validation/storefront";
import {
  StorefrontPreview,
  drawsProducts,
  textlessBlocks,
} from "./StorefrontPreview";

const CARD_ACTION_CLASS = iconButtonClass;

/**
 * How strongly the empty-state shapes read against the canvas.
 *
 * Applied once to the whole SVG rather than per shape, so the group flattens to
 * a single tint instead of the shapes showing through each other where they
 * overlap. Tuned so a saturated accent lands as a soft wash on white and still
 * carries on the near-black "Luxe" canvas.
 */
const SHAPE_OPACITY = 0.3;

/**
 * What a card shows when its storefront would render nothing.
 *
 * It sits OVER the preview rather than replacing it, so the storefront's own
 * canvas still comes through: an empty storefront that picked the dark "Luxe"
 * look should still read as dark here, and a blank grey box would throw away
 * the one thing an empty storefront has already decided.
 *
 * The decoration is drawn in the storefront's OWN accent, so an empty card
 * still shows something of the seller's taste rather than a stock placeholder,
 * and every card in the list looks different from its neighbour. Everything is
 * `currentColor` over a single `color` on the root, which means the accent is
 * set once and an accent that somehow is not strict hex simply inherits the
 * card's ink instead of painting an invalid attribute.
 *
 * The words keep their own opaque `background` pill. `foreground` is calibrated
 * against `background`, so contrast holds by construction on any canvas the
 * seller can pick, including a photo. That was learned the hard way: a
 * translucent scrim over the black canvas landed near neutral-300 and dragged
 * the text under AA. The fun is in the shapes; the label stays boring on
 * purpose.
 *
 * Deliberately static. The card already answers a hover with a lift, and a
 * second thing moving under it competed with that rather than adding to it.
 *
 * `aria-hidden` is inherited from the preview box, and correctly so: the card's
 * own metadata line already announces "0 blocks", so this is a visual echo of
 * something screen readers are told in words.
 */
function EmptyPreviewHint({ accent }: { accent: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <svg
        viewBox="0 0 200 150"
        aria-hidden="true"
        className="absolute inset-0 size-full"
        // One opacity for the whole group rather than per shape. Varying it
        // read as depth, which fought the flat geometric look: these are meant
        // to sit on the canvas as one family. Setting it on the root also means
        // overlapping shapes flatten to a single tint instead of showing
        // through each other.
        style={
          isStrictHexColor(accent)
            ? { color: accent, opacity: SHAPE_OPACITY }
            : { opacity: SHAPE_OPACITY }
        }
      >
        {/* Every shape is drawn past the viewBox on at least one side, so the
            frame cuts them rather than containing them. A shape running off the
            edge reads as a glimpse of something larger; the same shape tucked
            fully inside reads as a sticker. The SVG viewport clips them for
            free, so no mask is involved. */}
        <circle cx="-10" cy="56" r="48" fill="currentColor" />
        {/* Sat low enough that the frame takes the whole bottom of the ring,
            not just a nick out of it: a shape cut clean reads as deliberate,
            where a shape barely clipped reads as a mistake. */}
        <circle
          cx="183"
          cy="125"
          r="36.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="11"
        />
        {/* Four-point sparkles: two mirrored curves pinched at the centre. The
            large one threads between the embed and delete buttons, which end at
            y=26 while its wide axis sits at y=30. */}
        <path
          d="M143 3c2.03 18.6 8.1 24.3 27 27-18.9 2.7-25 8.4-27 27-2.03-18.6-8.1-24.3-27-27 18.9-2.7 25-8.4 27-27Z"
          fill="currentColor"
        />
        <path
          d="M38 99.5c1.24 11.4 4.95 14.85 16.5 16.5-11.55 1.65-15.26 5.13-16.5 16.5-1.24-11.4-4.95-14.85-16.5-16.5 11.55-1.65 15.26-5.13 16.5-16.5Z"
          fill="currentColor"
        />
      </svg>

      <span className="relative rounded-full border border-border bg-background px-2.5 py-1 font-inter text-xs font-medium text-foreground shadow-xs">
        No products yet
      </span>
    </div>
  );
}

// Presentational card. The whole card is a link to the editor (a stretched
// overlay), with the action buttons layered above it so they stay clickable
// without nesting a <button> inside an <a>.
export function StorefrontCard({
  storefront,
  productsById,
  canWrite,
  onEmbed,
  onDelete,
}: {
  storefront: StorefrontSummary;
  productsById: ReadonlyMap<string, Product>;
  /** Hide embed/delete controls when the active role is read-only. */
  canWrite: boolean;
  onEmbed: () => void;
  onDelete: () => void;
}) {
  const { id, name, blockCount, updatedAt, config } = storefront;

  // A storefront with something to sell is previewed exactly as designed,
  // words and all — the text is part of how that shop looks. One with no
  // product tiles is previewed without them: with nothing else in the box, its
  // type is all there is to see, and type shrunk to card size is a smudge
  // sitting directly above the card's own (readable) heading. Dropping it
  // leaves the shapes, or the empty-state hint below.
  const textless = !drawsProducts(config, productsById);

  // Keyed off what the preview will actually RENDER, not the raw block count:
  // a storefront whose every block is a hidden sold-out product still draws a
  // blank box, and that is the exact case an empty state has to cover. Asked
  // of the same block set the preview is about to draw, so a board of nothing
  // but words counts as empty here rather than looking broken.
  const isEmpty =
    (textless ? textlessBlocks(config, productsById) : buyerVisibleBlocks(config))
      .length === 0;

  return (
    <div
      className={cn(
        cardClass,
        "relative flex flex-col p-4 shadow-sm",
        hoverLiftClass,
      )}
    >
      {canWrite && (
        <Link
          href={`/storefront/${id}`}
          aria-label={`Edit ${name}`}
          className={cn("absolute inset-0 z-10 rounded-md", focusRingClass)}
        />
      )}

      <div className="pointer-events-none relative z-0">
        {/* Live miniature of the actual storefront: the WHOLE board, scaled
            down to fit this box rather than cropped to it. Wordless only when
            there is no product behind the words (see above). */}
        <div
          aria-hidden="true"
          className="relative aspect-[4/3] w-full overflow-hidden rounded-sm border border-border"
        >
          <StorefrontPreview
            config={config}
            productsById={productsById}
            textless={textless}
          />
          {isEmpty && <EmptyPreviewHint accent={config.theme.accent} />}
        </div>
        <div className="mt-3 pr-9">
          <h3 className="truncate text-base font-semibold text-foreground">
            {name}
          </h3>
          <p className="mt-0.5 font-inter text-sm text-muted-foreground">
            {blockCount} block{blockCount === 1 ? "" : "s"} · updated{" "}
            {formatOrderDate(updatedAt)}
          </p>
        </div>
      </div>

      {canWrite && (
        <div className="absolute right-3 top-3 z-20 flex gap-1.5">
          <button
            type="button"
            onClick={onEmbed}
            aria-label={`Embed ${name}`}
            className={cn(CARD_ACTION_CLASS, "hover:text-foreground")}
          >
            <Code className="size-4" strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${name}`}
            className={cn(CARD_ACTION_CLASS, "hover:text-destructive")}
          >
            <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
