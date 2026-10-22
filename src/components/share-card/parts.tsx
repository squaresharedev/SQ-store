"use client";

import type { CSSProperties, ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Image as ImageIcon } from "lucide-react";
import { BRAND_MARK, BRAND_SURFACE } from "@/lib/brand";
import { formatPriceShort } from "@/lib/format";
import type { Cutout } from "@/lib/share-card/cutout/engine";
import { MIN_MASK_CONFIDENCE } from "@/lib/share-card/cutout/refine";
import {
  SHARE_CARD_FORMATS,
  SHARE_CARD_WIDTH,
  type ShareCardFormat,
} from "@/lib/share-card/formats";
import type { ShareCardPalette } from "@/lib/share-card/palette";
import { qrPath } from "@/lib/share-card/qr";
import { cn } from "@/lib/utils";
import type { ShareCardProduct } from "./types";

/**
 * The pieces every share card template is built from. A share card is an
 * IMAGE: it has to look the same to whoever sees it, in light mode or dark,
 * so it is coloured from its own palette (lib/share-card/palette.ts), set as
 * inline colours, and never from the theme tokens dark mode flips.
 *
 * Templates place things in pixels of the card's logical size (360 wide, see
 * lib/share-card/formats.ts): a card is a fixed canvas, not a layout that
 * reflows, and the product has to stand exactly where the type behind it
 * expects it.
 */

/** Small print on a card: the store, the link, an eyebrow. */
export const SHARE_EYEBROW = "font-inter text-xs font-semibold uppercase tracking-widest";

/** The canvas: one format's exact size on the palette's ground, everything
 *  inside clipped to it. */
export function ShareCardFrame({
  format,
  palette,
  className,
  style,
  children,
}: {
  format: ShareCardFormat;
  palette: ShareCardPalette;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      data-share-card={format}
      className={cn("relative shrink-0 overflow-hidden", className)}
      style={{
        width: SHARE_CARD_WIDTH,
        height: SHARE_CARD_FORMATS[format].height,
        backgroundColor: palette.ground,
        color: palette.ink,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** A cutout a card can stand up: the model was sure where the product ends
 *  (a see-through product looks broken, not cut out), and the product was not
 *  cropped at the top or the sides of its photo (a flat cut edge in mid-air
 *  gives the trick away). Cropped at the base is fine: the card stands it on
 *  its own bottom edge. */
export function usableCutout(cutout: Cutout | null | undefined): cutout is Cutout {
  return Boolean(
    cutout &&
      cutout.confidence >= MIN_MASK_CONFIDENCE &&
      !cutout.bleeds.top &&
      !cutout.bleeds.left &&
      !cutout.bleeds.right,
  );
}

/** Where a product may stand, in card pixels. */
export type SubjectBox = { x: number; y: number; width: number; height: number };

/**
 * How the product is lifted off the card. A cutout follows its own outline
 * (drop-shadow, not box-shadow), so the shadow is the product's shape.
 */
const SUBJECT_FILTER = {
  /** Resting on the card. */
  lift: "drop-shadow(0 12px 16px rgb(0 0 0 / 0.28))",
  /** Hovering well above it. */
  float: "drop-shadow(0 26px 30px rgb(0 0 0 / 0.5))",
  /** A die-cut sticker: a white edge right round the outline, then a shadow. */
  sticker: [
    `drop-shadow(3px 0 0 ${BRAND_SURFACE})`,
    `drop-shadow(-3px 0 0 ${BRAND_SURFACE})`,
    `drop-shadow(0 3px 0 ${BRAND_SURFACE})`,
    `drop-shadow(0 -3px 0 ${BRAND_SURFACE})`,
    "drop-shadow(0 10px 14px rgb(0 0 0 / 0.3))",
  ].join(" "),
} as const;

export type SubjectEffect = keyof typeof SUBJECT_FILTER;

/** The resting shadow, for a template that places a cutout itself. */
export const SUBJECT_LIFT = SUBJECT_FILTER.lift;

/** The soft pool of shadow a product standing on the card sits in: its
 *  width against the product's, and its depth against its own width. */
const CONTACT_SHADOW = {
  width: 0.82,
  depth: 0.09,
  minDepth: 8,
  background: "radial-gradient(closest-side, rgb(0 0 0 / 0.38), transparent)",
};

/**
 * THE PRODUCT. With a cutout: the product alone, as big as `box` allows,
 * standing on the box's floor in a pool of shadow, in front of whatever the
 * template drew behind it. A product cropped at its base in the photo stands
 * on the card's own bottom edge instead. Without one (no photo, or a photo
 * the model could not separate): the photo itself, framed, in the same box.
 */
export function ShareCardSubject({
  product,
  cutout,
  box,
  cardHeight,
  effect = "lift",
  rotate = 0,
  frameClassName,
}: {
  product: ShareCardProduct;
  cutout: Cutout | null;
  box: SubjectBox;
  cardHeight: number;
  effect?: SubjectEffect;
  /** Degrees. */
  rotate?: number;
  /** The fallback photo's frame: radius, border. */
  frameClassName?: string;
}) {
  const turn = rotate ? `rotate(${rotate}deg)` : undefined;

  if (usableCutout(cutout)) {
    const floor = cutout.bleeds.bottom ? cardHeight : box.y + box.height;
    const height = floor - box.y;
    const aspect = cutout.width / cutout.height;
    const w = Math.min(box.width, height * aspect);
    const h = w / aspect;
    const left = box.x + (box.width - w) / 2;
    const top = floor - h;
    const shadowDepth = Math.max(CONTACT_SHADOW.minDepth, w * CONTACT_SHADOW.depth);
    return (
      <>
        {!cutout.bleeds.bottom && effect !== "sticker" && (
          <div
            aria-hidden="true"
            className="absolute rounded-full blur-xs"
            style={{
              left: left + (w * (1 - CONTACT_SHADOW.width)) / 2,
              top: floor - shadowDepth / 2,
              width: w * CONTACT_SHADOW.width,
              height: shadowDepth,
              background: CONTACT_SHADOW.background,
            }}
          />
        )}
        {/* eslint-disable-next-line @next/next/no-img-element -- a blob: URL made in this page. */}
        <img
          src={cutout.src}
          alt=""
          draggable={false}
          data-share-subject="cutout"
          className="absolute max-w-none"
          style={{ left, top, width: w, height: h, filter: SUBJECT_FILTER[effect], transform: turn }}
        />
      </>
    );
  }

  // The framed photo: square, as big as the box allows, on the box's floor.
  const side = Math.min(box.width, box.height);
  return (
    <div
      data-share-subject="photo"
      className={cn("absolute overflow-hidden rounded-md", frameClassName)}
      style={{
        left: box.x + (box.width - side) / 2,
        top: box.y + box.height - side,
        width: side,
        height: side,
        filter: SUBJECT_FILTER[effect === "float" ? "float" : "lift"],
        transform: turn,
      }}
    >
      {product.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed R2 URL with query params; next/image adds no value here.
        <img src={product.imageUrl} alt="" draggable={false} className="size-full object-cover" />
      ) : (
        <div className="flex size-full items-center justify-center bg-current/10">
          <ImageIcon className="size-10 opacity-50" strokeWidth={1.25} aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

/** The price a buyer pays, and while a sale runs the regular one struck
 *  through beside it. Short form ("€1,120"): a card has no room for cents. */
export function ShareCardPrice({
  product,
  className,
  strikeClassName = "text-sm",
}: {
  product: ShareCardProduct;
  className?: string;
  /** Size of the struck regular price, a step or two under the price. */
  strikeClassName?: string;
}) {
  const locale = useLocale();
  const { price, currency, sale } = product;
  return (
    <span className={cn("inline-flex flex-wrap items-baseline gap-x-2 tabular-nums", className)}>
      <span>{formatPriceShort(sale ? sale.price : price, currency, locale)}</span>
      {sale && (
        <s className={cn("font-medium opacity-60", strikeClassName)}>
          {formatPriceShort(price, currency, locale)}
        </s>
      )}
    </span>
  );
}

/** The price as one short string: what a buyer pays now. */
export function usePriceText(product: ShareCardProduct): string {
  const locale = useLocale();
  return formatPriceShort(product.sale ? product.sale.price : product.price, product.currency, locale);
}

/** What a card has to shout about, if anything: "Sold out" outranks a sale
 *  ("-30%"), and a product with neither has nothing to shout. */
export function useCallout(product: ShareCardProduct): { kind: "sold-out" | "sale"; label: string } | null {
  const tStock = useTranslations("Common.stock");
  const tSale = useTranslations("ProductPage.sale");
  if (product.soldOut) return { kind: "sold-out", label: tStock("soldOut") };
  const percent = product.sale?.offerPercent;
  return percent ? { kind: "sale", label: tSale("percentOff", { percent }) } : null;
}

/** The SQ mark, in the surrounding ink. */
export function ShareCardMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${BRAND_MARK.width} ${BRAND_MARK.height}`}
      className={cn("size-3 shrink-0", className)}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d={BRAND_MARK.path} />
    </svg>
  );
}

/** Whose product it is: the store's name beside the SQ mark. */
export function ShareCardStore({ product, className }: { product: ShareCardProduct; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", SHARE_EYEBROW, className)}>
      <ShareCardMark />
      <span className="truncate">{product.storeName}</span>
    </span>
  );
}

/** A QR code to the product page, in the surrounding ink. */
export function ShareCardQr({ url, className }: { url: string; className?: string }) {
  const { size, path } = qrPath(url);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={cn("shrink-0", className)}
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}
