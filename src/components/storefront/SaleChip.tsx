"use client";

import type { CSSProperties } from "react";
import type { tileSpotTokenProps } from "./TileSpotDragLayer";
import { useLocale, useTranslations } from "next-intl";
import { formatPriceShort } from "@/lib/format";
import { legibleInkOn, readableInkOn } from "@/lib/format/color";
import { cn } from "@/lib/utils";
import type { Currency } from "@/types/product";
import {
  spotColumn,
  spotRow,
  type SaleBadge,
  type SaleBadgeLook,
  type TileSpot,
} from "@/types/storefront";
import { TILE_SPOT_CLASSES, roundForCss, sharedRowRoom } from "./config-maps";

/** The widest a character of the chip's words runs, in its type size: bold,
 *  in capitals, with a little tracking. An upper bound on purpose, like the
 *  price's: a chip measured too narrow is a chip its tile cuts off. */
const CHIP_CHAR_WIDTH = 0.75;

/** A pill's padding, in its type size. */
const PILL = { inline: 0.7, block: 0.32 };

/** A sticker: round, at least `minSize` across, with a thin ring `ringInset` in
 *  from its edge, put on at a tilt. */
const STICKER = { padding: 0.62, minSize: 3.5, ringInset: 0.16, ring: 0.07, tilt: "-10deg" };

/** A flag: padded more at its tail, where the notch cuts `notch` into it. */
const FLAG = { inline: 0.6, edge: 0.55, tail: 1.05, notch: 0.5 };

/** A ribbon's band: its thickness (line plus padding), and the room its words
 *  keep from where the band leaves the tile. */
const RIBBON = { lineHeight: 1.1, padding: 0.3, margin: 0.8 };
const RIBBON_BAND = RIBBON.lineHeight + 2 * RIBBON.padding;

/** A ribbon BANNER, a ribbon where there is no corner to cross: the band's
 *  padding, then its two ends, each `tail` long, sticking out `overhang`
 *  past the band, hung `drop` below it and cut `notch` deep (a swallowtail).
 *  The part of an end tucked under the band shows as a darker fold. */
const RIBBON_BANNER = { inline: 0.7, tail: 1.15, overhang: 0.75, drop: 0.32, notch: 0.42 };

/** Where a flag hangs: flush against the photo's edge in its spot's row, its
 *  column kept (a middle flag hangs from nothing, so it keeps the spot). */
const FLAG_SPOT_CLASSES: Record<TileSpot, string> = {
  "top-left": "top-0 left-[var(--tag-inset,8px)]",
  "top-center": "top-0 left-1/2 -translate-x-1/2",
  "top-right": "top-0 right-[var(--tag-inset,8px)]",
  "middle-center": TILE_SPOT_CLASSES["middle-center"],
  "bottom-left": "bottom-0 left-[var(--tag-inset,8px)]",
  "bottom-center": "bottom-0 left-1/2 -translate-x-1/2",
  "bottom-right": "bottom-0 right-[var(--tag-inset,8px)]",
};

/** A ribbon's box: flush in its corner. A middle spot gets the banner instead
 *  (ribbonBanner). */
const RIBBON_CORNER_CLASSES: Partial<Record<TileSpot, string>> = {
  "top-left": "top-0 left-0",
  "top-right": "top-0 right-0",
  "bottom-left": "bottom-0 left-0",
  "bottom-right": "bottom-0 right-0",
};

/** Whether a ribbon at `spot` is the BANNER: a middle spot has no corner for
 *  the band to cross (see SALE_BADGE_LOOKS). */
function ribbonBanner(spot: TileSpot): boolean {
  return spotColumn(spot) === "center";
}

/**
 * A ribbon's measurements, in its type size, for words `words` wide. The band
 * crosses the corner square at `offset` along each edge; its inner edge is
 * cut by the tile to a chord the words must fit (with `margin`), which sets
 * how far out the band runs, and the corner box is as big as its outer edge.
 */
function ribbonGeometry(words: number): { offset: number; box: number; length: number } {
  const reach = (words + RIBBON.margin) / 2 + RIBBON_BAND / 2;
  const outer = reach + RIBBON_BAND / 2;
  return { offset: reach / Math.SQRT2, box: outer * Math.SQRT2, length: 2 * outer + 0.5 };
}

/**
 * How much of its row a chip saying `label` takes, in the tag's type size, as
 * it is drawn at `spot`. What the shared-row give-way rules count, here and
 * for the struck price (priceTagWasStyle).
 */
export function saleChipWidth(look: SaleBadgeLook, spot: TileSpot, label: string): number {
  const words = [...label].length * CHIP_CHAR_WIDTH;
  switch (look) {
    case "pill":
      return words + 2 * PILL.inline;
    case "sticker":
      return Math.max(words + 2 * STICKER.padding, STICKER.minSize);
    case "flag":
      return words + 2 * FLAG.inline;
    case "ribbon":
      return ribbonBanner(spot)
        ? words + 2 * (RIBBON_BANNER.inline + RIBBON_BANNER.overhang)
        : ribbonGeometry(words).box;
  }
}

/** What a chip on one product has to say: the reduction in money and, where
 *  it is at least 1%, in percent (ProductTileSale.offerPercent). */
export type SaleChipOffer = { amountCents: number; percent: number | null; currency: Currency };

/**
 * What the chip SAYS, worded for the buyer (SALE_BADGES): the percentage, the
 * amount (also what a percentage under 1% says instead), or the word.
 */
export function useSaleChipWords(): (says: Exclude<SaleBadge, "hidden">, offer: SaleChipOffer) => string {
  const t = useTranslations("ProductPage.sale");
  const locale = useLocale();
  return (says, offer) => {
    if (says === "sale") return t("badgeSale");
    if (says === "percent" && offer.percent !== null) return t("percentOff", { percent: offer.percent });
    return t("amountOff", { amount: formatPriceShort(offer.amountCents / 100, offer.currency, locale) });
  };
}

/**
 * THE SALE CHIP, as a tile wears it and as its picker shows it: one drawing
 * for each of SALE_BADGE_LOOKS, so the picture a seller picks from is the chip
 * a buyer sees.
 *
 * Sized from `size` (the price tag's own type size on a tile), every measure
 * in it a share of that, so it scales with its tile. Its words are the
 * seller's colour where it carries on the fill, and whichever ink reads on it
 * otherwise (legibleInkOn): a chip whose words vanish says nothing.
 *
 * `besidePrice` is given when it SHARES ITS ROW with the floated price (see
 * resolveSaleBadgePosition). Side by side the two fit a desktop tile and
 * collide on a phone-size one, so the chip then gives way where the row
 * cannot hold both: its width resolves to zero by the same kind of test the
 * struck price uses (priceTagWasStyle), which gives way first. The price
 * itself never moves.
 */
export function SaleChip({
  look,
  says,
  label,
  spot,
  fill,
  textColor,
  fontClass,
  size,
  besidePrice,
  style,
  token,
}: {
  look: SaleBadgeLook;
  /** What it says, for the data attribute tests and agents read. */
  says: SaleBadge;
  /** Its words, from useSaleChipWords. */
  label: string;
  /** Where it renders (resolveSaleBadgePosition). */
  spot: TileSpot;
  fill: string;
  /** Its words' colour, strict hex. Absent is whichever ink reads on the fill. */
  textColor?: string;
  /** The price tag's typeface (PRICE_TAG_FONT_CLASSES). */
  fontClass: string;
  /** Its type size, a CSS length. */
  size: string;
  /** The floated price chip's width (chipWidth) and border, when it shares
   *  the row. */
  besidePrice?: { width: number; borderWidth: number };
  /** The tile's inset variable (priceTagInsetStyle). */
  style?: CSSProperties;
  /** On the designer's canvas: what makes the chip a draggable, pressable
   *  token (tileSpotTokenProps). Absent, it takes no pointer at all. */
  token?: ReturnType<typeof tileSpotTokenProps>;
}) {
  const ink = legibleInkOn(textColor ?? readableInkOn(fill), fill);
  const words = [...label].length * CHIP_CHAR_WIDTH;
  // Zero when the row cannot hold both chips, unbounded when it can.
  const room = besidePrice
    ? `clamp(0px, calc((${sharedRowRoom(besidePrice.width)} - ${besidePrice.borderWidth * 2}px - var(--tag-font-size) * ${roundForCss(saleChipWidth(look, spot, label))}) * 9999), 9999px)`
    : null;
  const fit = (length: string) => (room ? `min(${length}, var(--tag-badge-room))` : length);
  const sized = {
    "--tag-font-size": size,
    ...(room ? { "--tag-badge-room": room } : {}),
    fontSize: "var(--tag-font-size)",
    ...style,
  } as CSSProperties;
  // The token's own classes come first, so a look's shape wins over the
  // token's hover ring radius: rounded-full on a pill and a sticker, and
  // SHARP (rounded-none) on a flag and a ribbon, which are cut, not rounded.
  const shared = cn(
    "absolute z-10 whitespace-nowrap font-bold uppercase tracking-wide",
    token ? token.className : "pointer-events-none",
    fontClass,
  );
  const data = { ...token, className: undefined, "data-tile-sale-badge": says, "data-sale-chip-look": look };

  if (look === "ribbon" && ribbonBanner(spot)) {
    const { inline, tail, overhang, drop, notch } = RIBBON_BANNER;
    // The ends are the fill in shadow, and the fold where each tucks under
    // the band deeper still: the seller's colour, never a second one.
    const shade = `color-mix(in srgb, ${fill} 70%, black)`;
    const fold = `color-mix(in srgb, ${fill} 45%, black)`;
    const tucked = `${roundForCss(tail - overhang)}em`;
    return (
      <span
        {...data}
        className={cn(shared, "isolate rounded-none drop-shadow-sm", TILE_SPOT_CLASSES[spot])}
        style={{ ...sized, lineHeight: RIBBON.lineHeight }}
      >
        {(["left", "right"] as const).map((side) => (
          <span key={side} aria-hidden="true">
            <span
              className="absolute -z-10"
              style={{
                top: `${drop}em`,
                height: "100%",
                width: `${tail}em`,
                left: side === "left" ? `-${overhang}em` : undefined,
                right: side === "right" ? `-${overhang}em` : undefined,
                backgroundColor: shade,
                clipPath:
                  side === "left"
                    ? `polygon(0 0, 100% 0, 100% 100%, 0 100%, ${notch}em 50%)`
                    : `polygon(0 0, 100% 0, calc(100% - ${notch}em) 50%, 100% 100%, 0 100%)`,
              }}
            />
            <span
              className="absolute -z-10"
              style={{
                top: "100%",
                height: `${drop}em`,
                width: tucked,
                left: side === "left" ? 0 : undefined,
                right: side === "right" ? 0 : undefined,
                backgroundColor: fold,
                clipPath: side === "left" ? "polygon(0 0, 100% 0, 100% 100%)" : "polygon(0 0, 100% 0, 0 100%)",
              }}
            />
          </span>
        ))}
        <span
          className="relative block"
          style={{ paddingInline: `${inline}em`, paddingBlock: `${RIBBON.padding}em`, backgroundColor: fill, color: ink }}
        >
          {label}
        </span>
      </span>
    );
  }

  if (look === "ribbon") {
    const { offset, box, length } = ribbonGeometry(words);
    const row = spotRow(spot) === "top" ? "top" : "bottom";
    const column = spotColumn(spot) === "left" ? "left" : "right";
    // The band runs across the corner, so it falls toward the corner's own
    // diagonal: up to the right from a top-left or bottom-right corner.
    const falling = (row === "top") === (column === "left");
    return (
      <span
        {...data}
        className={cn(shared, "overflow-hidden rounded-none", RIBBON_CORNER_CLASSES[spot])}
        style={{ ...sized, width: fit(`${roundForCss(box)}em`), height: fit(`${roundForCss(box)}em`) }}
      >
        <span
          className="absolute block text-center shadow-sm"
          style={{
            top: row === "top" ? `${roundForCss(offset)}em` : undefined,
            bottom: row === "bottom" ? `${roundForCss(offset)}em` : undefined,
            left: column === "left" ? `${roundForCss(offset)}em` : undefined,
            right: column === "right" ? `${roundForCss(offset)}em` : undefined,
            width: `${roundForCss(length)}em`,
            translate: `${column === "left" ? "-50%" : "50%"} ${row === "top" ? "-50%" : "50%"}`,
            rotate: falling ? "-45deg" : "45deg",
            lineHeight: RIBBON.lineHeight,
            paddingBlock: `${RIBBON.padding}em`,
            backgroundColor: fill,
            color: ink,
          }}
        >
          {label}
        </span>
      </span>
    );
  }

  if (look === "sticker") {
    return (
      <span
        {...data}
        className={cn(shared, "grid place-items-center overflow-hidden rounded-full text-center leading-none drop-shadow-sm", TILE_SPOT_CLASSES[spot])}
        style={{
          ...sized,
          aspectRatio: "1",
          padding: fit(`${STICKER.padding}em`),
          minWidth: fit(`${STICKER.minSize}em`),
          ...(room ? { maxWidth: "var(--tag-badge-room)", maxHeight: "var(--tag-badge-room)" } : {}),
          rotate: STICKER.tilt,
          backgroundColor: fill,
          color: ink,
          // A thin ring just inside the edge, in the ink at half strength:
          // the fill-coloured shadow on top masks all of the second but a
          // hairline. The lift off the photo is a drop shadow (a filter), so
          // a chip that has given way leaves no smudge behind.
          boxShadow: `inset 0 0 0 ${STICKER.ringInset}em ${fill}, inset 0 0 0 calc(${STICKER.ringInset}em + max(1px, ${STICKER.ring}em)) color-mix(in srgb, ${ink} 50%, transparent)`,
        }}
      >
        {label}
      </span>
    );
  }

  if (look === "flag") {
    // Hangs from the top edge (or from nothing, in the middle) with its tail
    // notched below; from the bottom edge it stands up, notched above.
    const fromTop = spotRow(spot) !== "bottom";
    const notch = `${FLAG.notch}em`;
    return (
      <span
        {...data}
        className={cn(shared, "overflow-hidden rounded-none", FLAG_SPOT_CLASSES[spot])}
        style={{
          ...sized,
          lineHeight: 1.1,
          paddingInline: fit(`${FLAG.inline}em`),
          paddingTop: `${fromTop ? FLAG.edge : FLAG.tail}em`,
          paddingBottom: `${fromTop ? FLAG.tail : FLAG.edge}em`,
          ...(room ? { maxWidth: "var(--tag-badge-room)" } : {}),
          clipPath: fromTop
            ? `polygon(0 0, 100% 0, 100% 100%, 50% calc(100% - ${notch}), 0 100%)`
            : `polygon(0 0, 50% ${notch}, 100% 0, 100% 100%, 0 100%)`,
          backgroundColor: fill,
          color: ink,
        }}
      >
        {label}
      </span>
    );
  }

  return (
    <span
      {...data}
      className={cn(shared, "overflow-hidden rounded-full drop-shadow-sm", TILE_SPOT_CLASSES[spot])}
      style={{
        ...sized,
        lineHeight: 1.15,
        paddingInline: fit(`${PILL.inline}em`),
        paddingBlock: `${PILL.block}em`,
        ...(room ? { maxWidth: "var(--tag-badge-room)" } : {}),
        backgroundColor: fill,
        color: ink,
      }}
    >
      {label}
    </span>
  );
}
