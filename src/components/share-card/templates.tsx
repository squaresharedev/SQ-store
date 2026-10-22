"use client";

import { useId, type ComponentType, type ReactNode } from "react";
import { useLocale } from "next-intl";
import { BRAND_SURFACE } from "@/lib/brand";
import type { Cutout } from "@/lib/share-card/cutout/engine";
import { SHARE_CARD_FORMATS, SHARE_CARD_WIDTH, type ShareCardFormat } from "@/lib/share-card/formats";
import { SHARE_CARD_FALLBACK_HUES, shareCardPalette } from "@/lib/share-card/palette";
import { headlineLines } from "@/lib/share-card/text";
import { cn } from "@/lib/utils";
import { useFittedSizes } from "./fit";
import {
  SHARE_EYEBROW,
  ShareCardFrame,
  ShareCardPrice,
  ShareCardQr,
  ShareCardStore,
  ShareCardSubject,
  SUBJECT_LIFT,
  usableCutout,
  useCallout,
  usePriceText,
} from "./parts";
import type { ShareCardProduct } from "./types";

/**
 * THE SHARE CARD TEMPLATES. Every one is built for depth: the product, cut
 * out of its photo, stands IN FRONT of type set big behind it (a masthead it
 * covers, rows of its own name, its price, a frame it climbs out of, a ring
 * of words round it), so the card reads as layers rather than a photo with a
 * caption. Colours come from the product itself (lib/share-card/palette.ts).
 *
 * Without a cutout (no photo, a photo the model could not separate, or one
 * still being cut out) every template still stands: ShareCardSubject puts the
 * photo itself, framed, where the product would be.
 *
 * Geometry is in card pixels (360 wide) and fractions of the card's height,
 * per format, in each template's own table.
 */

export type ShareCardTemplateProps = {
  product: ShareCardProduct;
  format: ShareCardFormat;
  cutout: Cutout | null;
};

const W = SHARE_CARD_WIDTH;

/** The card's margin, in card pixels (Tailwind's 5: inset-x-5 and px-5). */
const PAD = 20;

/** Each format's height. */
const heightOf = (format: ShareCardFormat) => SHARE_CARD_FORMATS[format].height;

/**
 * A headline set line by line, each line at its own fitted size (fit.ts).
 * The space between lines is real text: drawn as blocks, the words would
 * otherwise run together for anything that reads the card ("WALNUTSERVING").
 */
function HeadlineLines({
  lines,
  sizes,
  leading = 1,
}: {
  lines: readonly string[];
  sizes: readonly number[];
  /** Line height against each line's size. */
  leading?: number;
}) {
  return lines.map((line, i) => (
    <span key={i} className="block whitespace-nowrap" style={{ fontSize: sizes[i], lineHeight: leading }}>
      {line}
      {i < lines.length - 1 && " "}
    </span>
  ));
}

// ---------------------------------------------------------------------------
// MASTHEAD: a magazine cover. The name set as the masthead, the product
// standing in front of its lower half.
// ---------------------------------------------------------------------------

const MASTHEAD = {
  square: { lines: 2, budget: 18, max: 92, top: 36, subjectTop: 0.3, bottomGap: 62 },
  portrait: { lines: 3, budget: 26, max: 100, top: 38, subjectTop: 0.34, bottomGap: 66 },
  story: { lines: 3, budget: 26, max: 116, top: 48, subjectTop: 0.34, bottomGap: 78 },
} as const;

/** Masthead line height against its size: capitals, set solid. */
const MASTHEAD_LEADING = 0.86;

function MastheadCard({ product, format, cutout }: ShareCardTemplateProps) {
  const locale = useLocale();
  const H = heightOf(format);
  const layout = MASTHEAD[format];
  const palette = shareCardPalette(cutout?.colour ?? null, "light", SHARE_CARD_FALLBACK_HUES.cream);
  const lines = headlineLines(product.title, layout.lines, layout.budget).map((line) =>
    line.toLocaleUpperCase(locale),
  );
  const sizes = useFittedSizes(lines.join("\n"), { width: W - 2 * PAD, max: layout.max, tracking: -0.05 });
  const callout = useCallout(product);
  const subjectTop = H * layout.subjectTop;
  return (
    <ShareCardFrame format={format} palette={palette}>
      <div className="absolute inset-x-5 top-4 flex items-center justify-between gap-3">
        <ShareCardStore product={product} />
        <span className={cn("truncate", SHARE_EYEBROW)} style={{ color: palette.soft }}>
          {product.urlLabel}
        </span>
      </div>
      <p className="absolute inset-x-5 font-display font-bold tracking-tighter" style={{ top: layout.top }}>
        <HeadlineLines lines={lines} sizes={sizes} leading={MASTHEAD_LEADING} />
      </p>
      <ShareCardSubject
        product={product}
        cutout={cutout}
        cardHeight={H}
        box={{ x: PAD, y: subjectTop, width: W - 2 * PAD, height: H - layout.bottomGap - subjectTop }}
      />
      {callout && (
        <span
          data-share-callout={callout.kind}
          className="absolute flex size-16 rotate-12 items-center justify-center rounded-full p-1 text-center font-display text-sm font-bold uppercase leading-none shadow-md"
          style={{ right: PAD - 4, top: subjectTop + 8, backgroundColor: palette.accent, color: palette.accentInk }}
        >
          {callout.label}
        </span>
      )}
      <div className="absolute inset-x-5 bottom-4 flex items-end justify-between gap-3">
        <div className="flex min-w-0 items-end gap-2.5">
          <ShareCardQr url={product.url} className="size-10" />
          <p className="line-clamp-2 min-w-0 font-inter text-xs font-medium leading-snug" style={{ color: palette.soft }}>
            {product.title}
          </p>
        </div>
        <ShareCardPrice product={product} className="shrink-0 font-display text-2xl font-bold" />
      </div>
    </ShareCardFrame>
  );
}

// ---------------------------------------------------------------------------
// ECHO: the name, again and again, in outlined rows filling the card; one
// row solid, running behind the product.
// ---------------------------------------------------------------------------

const ECHO = {
  square: { size: 44, subjectTop: 0.1, bottomGap: 92 },
  portrait: { size: 48, subjectTop: 0.1, bottomGap: 96 },
  story: { size: 56, subjectTop: 0.14, bottomGap: 112 },
} as const;

/** Row height against the type size. */
const ECHO_LEADING = 0.94;

/** Each row's sideways start, in em, cycled, so no two rows line up. */
const ECHO_OFFSETS = [-0.4, -2.6, -1.3, -3.4, -0.9] as const;

/** The outlined rows' stroke, in card pixels. */
const ECHO_STROKE = 1.25;

/** How many characters a row runs to: well past the card's width. */
const ECHO_ROW_CHARS = 48;

function EchoCard({ product, format, cutout }: ShareCardTemplateProps) {
  const locale = useLocale();
  const H = heightOf(format);
  const layout = ECHO[format];
  const palette = shareCardPalette(cutout?.colour ?? null, "deep", SHARE_CARD_FALLBACK_HUES.cobalt);
  const word = (headlineLines(product.title, 1, 14)[0] ?? "").toLocaleUpperCase(locale);
  const row = `${word} • `.repeat(Math.max(1, Math.ceil(ECHO_ROW_CHARS / (word.length + 3))));
  const rowHeight = layout.size * ECHO_LEADING;
  const rows = Math.ceil(H / rowHeight) + 1;
  const subjectTop = H * layout.subjectTop;
  // The solid row: the one level with the middle of where the product stands.
  const solidRow = Math.floor((subjectTop + (H - layout.bottomGap)) / 2 / rowHeight);
  const callout = useCallout(product);
  return (
    <ShareCardFrame format={format} palette={palette}>
      <div aria-hidden="true" className="absolute inset-0 font-display font-bold tracking-tight">
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="whitespace-nowrap"
            style={{
              fontSize: layout.size,
              lineHeight: ECHO_LEADING,
              marginLeft: `${ECHO_OFFSETS[i % ECHO_OFFSETS.length]}em`,
              color: i === solidRow ? palette.accent : "transparent",
              WebkitTextStroke: i === solidRow ? undefined : `${ECHO_STROKE}px ${palette.soft}`,
            }}
          >
            {row}
          </div>
        ))}
      </div>
      <ShareCardSubject
        product={product}
        cutout={cutout}
        cardHeight={H}
        effect="float"
        box={{ x: PAD, y: subjectTop, width: W - 2 * PAD, height: H - layout.bottomGap - subjectTop }}
      />
      <span className="absolute left-4 top-4 px-2 py-1" style={{ backgroundColor: palette.ground }}>
        <ShareCardStore product={product} />
      </span>
      <div
        className="absolute inset-x-0 bottom-0 px-5 pb-5 pt-12"
        style={{ background: `linear-gradient(to top, ${palette.ground} 58%, transparent)` }}
      >
        <p className="truncate font-display text-xl font-semibold">{product.title}</p>
        <div className="mt-2 flex items-center gap-3">
          <span className="rounded-full px-3 py-1" style={{ backgroundColor: palette.accent, color: palette.accentInk }}>
            <ShareCardPrice product={product} className="font-display text-lg font-bold" strikeClassName="text-xs" />
          </span>
          {callout && (
            <span data-share-callout={callout.kind} className={SHARE_EYEBROW} style={{ color: palette.accent }}>
              {callout.label}
            </span>
          )}
        </div>
      </div>
    </ShareCardFrame>
  );
}

// ---------------------------------------------------------------------------
// NUMERALS: the price, gigantic, behind the product.
// ---------------------------------------------------------------------------

/** The figure sits high and the product stands over its lower half only,
 *  as on the masthead: covered further, a price stops reading as one. */
const NUMERALS = {
  square: { max: 160, giantTop: 0.17, subjectTop: 0.4, bottomGap: 24 },
  portrait: { max: 190, giantTop: 0.17, subjectTop: 0.38, bottomGap: 30 },
  story: { max: 230, giantTop: 0.2, subjectTop: 0.38, bottomGap: 52 },
} as const;

/** The giant figure runs this close to the card's edges, in card pixels. */
const NUMERALS_INSET = 8;

function NumeralsCard({ product, format, cutout }: ShareCardTemplateProps) {
  const locale = useLocale();
  const H = heightOf(format);
  const layout = NUMERALS[format];
  const palette = shareCardPalette(cutout?.colour ?? null, "vivid", SHARE_CARD_FALLBACK_HUES.signal);
  const callout = useCallout(product);
  const priceText = usePriceText(product);
  const giant = callout?.kind === "sold-out" ? callout.label.toLocaleUpperCase(locale) : priceText;
  const [size] = useFittedSizes(giant, { width: W - 2 * NUMERALS_INSET, max: layout.max, tracking: -0.05 });
  const subjectTop = H * layout.subjectTop;
  return (
    <ShareCardFrame format={format} palette={palette}>
      <div className="absolute inset-x-5 top-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="line-clamp-2 font-display text-lg font-semibold leading-tight">{product.title}</p>
          {product.sale && !product.soldOut && (
            <p className="mt-1 flex items-center gap-2 font-inter text-xs font-semibold">
              <s style={{ color: palette.soft }}>
                <ShareCardPrice product={{ ...product, sale: null }} />
              </s>
              {callout && <span data-share-callout={callout.kind}>{callout.label}</span>}
            </p>
          )}
        </div>
        <ShareCardStore product={product} className="shrink-0 pt-1" />
      </div>
      <p
        aria-hidden="true"
        className="absolute whitespace-nowrap text-center font-display font-bold leading-none tracking-tighter"
        style={{ left: NUMERALS_INSET, right: NUMERALS_INSET, top: H * layout.giantTop, fontSize: size }}
      >
        {giant}
      </p>
      <ShareCardSubject
        product={product}
        cutout={cutout}
        cardHeight={H}
        box={{ x: PAD * 2, y: subjectTop, width: W - 4 * PAD, height: H - layout.bottomGap - subjectTop }}
      />
    </ShareCardFrame>
  );
}

// ---------------------------------------------------------------------------
// POP-OUT: the product's own photo in a frame, and the product climbing out
// of the top of it. The cutout lies exactly over the photo, so inside the
// frame the two are one picture, and above the frame's edge only the cutout
// is left: the product, stepping out of its photo.
// ---------------------------------------------------------------------------

const POPOUT = {
  square: { titleLines: 1, titleMax: 38, top: 0.07 },
  portrait: { titleLines: 2, titleMax: 42, top: 0.07 },
  story: { titleLines: 2, titleMax: 52, top: 0.1 },
} as const;

/** Card pixels: the frame's least inset from the card's sides; the product's
 *  least room either side; the photo kept below the product's base; the gap
 *  above the title; the bottom row (price and store) with its margin. */
const POPOUT_SPACE = { frameInset: 28, sideRoom: 44, floor: 18, title: 14, bottomRow: 52 };

/** How much of the product, from its top, climbs out of the frame. */
const POPOUT_RISE = 0.42;

/** The frame's border, in card pixels. */
const POPOUT_BORDER = 4;

function PopoutCard({ product, format, cutout }: ShareCardTemplateProps) {
  const locale = useLocale();
  const H = heightOf(format);
  const layout = POPOUT[format];
  const palette = shareCardPalette(cutout?.colour ?? null, "light", SHARE_CARD_FALLBACK_HUES.sage);
  const lines = headlineLines(product.title, layout.titleLines, 22).map((line) => line.toLocaleUpperCase(locale));
  const sizes = useFittedSizes(lines.join("\n"), { width: W - 2 * PAD, max: layout.titleMax, tracking: -0.05 });
  const callout = useCallout(product);

  // From the bottom up: the bottom row, the title above it, the frame above that.
  const titleTop = H - POPOUT_SPACE.bottomRow - sizes.reduce((sum, size) => sum + size, 0);
  const frameFloor = titleTop - POPOUT_SPACE.title;
  const floor = frameFloor - POPOUT_SPACE.floor;
  const top = H * layout.top;

  const popping = usableCutout(cutout) && product.imageUrl ? cutout : null;
  let stage: ReactNode;
  let frameTop = top;
  if (popping) {
    const { box, width: photoWidth, height: photoHeight } = popping.source;
    const scale = Math.min((floor - top) / box.height, (W - 2 * POPOUT_SPACE.sideRoom) / box.width);
    const subject = { width: box.width * scale, height: box.height * scale, left: 0, top: 0 };
    subject.left = (W - subject.width) / 2;
    subject.top = floor - subject.height;
    const photo = {
      left: subject.left - box.x * scale,
      top: subject.top - box.y * scale,
      width: photoWidth * scale,
      height: photoHeight * scale,
    };
    const frame = {
      left: Math.max(POPOUT_SPACE.frameInset, photo.left),
      right: Math.min(W - POPOUT_SPACE.frameInset, photo.left + photo.width),
      top: subject.top + subject.height * POPOUT_RISE,
      bottom: Math.min(frameFloor, photo.top + photo.height),
    };
    frameTop = frame.top;
    const frameBox = {
      left: frame.left,
      top: frame.top,
      width: frame.right - frame.left,
      height: frame.bottom - frame.top,
    };
    stage = (
      <>
        <div aria-hidden="true" className="absolute overflow-hidden rounded-lg" style={frameBox}>
          {/* eslint-disable-next-line @next/next/no-img-element -- signed R2 URL with query params; next/image adds no value here. */}
          <img
            src={product.imageUrl!}
            alt=""
            draggable={false}
            className="absolute max-w-none"
            style={{
              left: photo.left - frame.left,
              top: photo.top - frame.top,
              width: photo.width,
              height: photo.height,
            }}
          />
        </div>
        <div
          aria-hidden="true"
          className="absolute rounded-lg"
          style={{ ...frameBox, boxShadow: `inset 0 0 0 ${POPOUT_BORDER}px ${palette.ink}` }}
        />
        {/* eslint-disable-next-line @next/next/no-img-element -- a blob: URL made in this page. */}
        <img
          src={popping.src}
          alt=""
          draggable={false}
          data-share-subject="cutout"
          className="absolute max-w-none"
          style={{ ...subject, filter: SUBJECT_LIFT }}
        />
      </>
    );
  } else {
    stage = (
      <ShareCardSubject
        product={product}
        cutout={null}
        cardHeight={H}
        box={{ x: POPOUT_SPACE.sideRoom, y: top, width: W - 2 * POPOUT_SPACE.sideRoom, height: floor - top }}
      />
    );
  }

  return (
    <ShareCardFrame format={format} palette={palette}>
      {stage}
      {callout && (
        <span
          data-share-callout={callout.kind}
          className="absolute rotate-6 px-2.5 py-1 font-display text-sm font-bold uppercase shadow-md"
          style={{ right: POPOUT_SPACE.frameInset - 10, top: frameTop - 14, backgroundColor: palette.ink, color: palette.ground }}
        >
          {callout.label}
        </span>
      )}
      <p className="absolute inset-x-5 font-display font-bold tracking-tighter" style={{ top: titleTop }}>
        <HeadlineLines lines={lines} sizes={sizes} />
      </p>
      <div className="absolute inset-x-5 bottom-4 flex items-end justify-between gap-3">
        <ShareCardPrice product={product} className="font-display text-2xl font-bold" />
        <ShareCardStore product={product} className="pb-1" />
      </div>
    </ShareCardFrame>
  );
}

// ---------------------------------------------------------------------------
// ORBIT: a ring of words round the product. Its back half behind the product
// and dimmed, its front half crossing in front.
// ---------------------------------------------------------------------------

const ORBIT = {
  square: { subjectTop: 0.08, subjectBottom: 0.72, cy: 0.52, rx: 160, ry: 42, titleMax: 30 },
  portrait: { subjectTop: 0.08, subjectBottom: 0.7, cy: 0.5, rx: 162, ry: 48, titleMax: 34 },
  story: { subjectTop: 0.12, subjectBottom: 0.66, cy: 0.47, rx: 164, ry: 56, titleMax: 40 },
} as const;

/** The ring's type, in card pixels: the size aimed for, and the bounds the
 *  size may move within to make whole repeats of the words fill the ring. */
const ORBIT_TYPE = { target: 20, min: 15, max: 27 };

/** The ring's tilt, in degrees. */
const ORBIT_TILT = -9;

/** How faint the ring's back half is: the far side of the ring. */
const ORBIT_BACK_OPACITY = 0.45;

/** A capital and its share of the tracking, in em: how many fit round. */
const ORBIT_CHAR_EM = 0.78;

/** The product's half-width, against the ring's: the ring passes outside it. */
const ORBIT_SUBJECT_SHARE = 0.72;

/** An ellipse's perimeter (Ramanujan), for the text that runs round it. */
function ellipsePerimeter(rx: number, ry: number): number {
  return Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
}

function OrbitCard({ product, format, cutout }: ShareCardTemplateProps) {
  const locale = useLocale();
  const H = heightOf(format);
  const layout = ORBIT[format];
  const palette = shareCardPalette(cutout?.colour ?? null, "deep", SHARE_CARD_FALLBACK_HUES.teal);
  const callout = useCallout(product);
  const priceText = usePriceText(product);
  const titleLines = headlineLines(product.title, 2, 22).map((line) => line.toLocaleUpperCase(locale));
  const sizes = useFittedSizes(titleLines.join("\n"), { width: W - 2 * PAD, max: layout.titleMax, tracking: -0.025 });
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  const cx = W / 2;
  const cy = H * layout.cy;
  const { rx, ry } = layout;
  // Counter-clockwise from the left: the FRONT (lower) half runs left to
  // right, upright; the back half runs over the top, upside down, as the far
  // side of a real ring would.
  const ring = `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy}`;
  const perimeter = ellipsePerimeter(rx, ry);
  const phrase = [headlineLines(product.title, 1, 26)[0]?.toLocaleUpperCase(locale) ?? "", priceText, callout?.label.toLocaleUpperCase(locale), product.storeName.toLocaleUpperCase(locale)]
    .filter(Boolean)
    .join(" • ")
    .concat(" • ");
  const repeats = Math.max(1, Math.round(perimeter / (ORBIT_TYPE.target * ORBIT_CHAR_EM * phrase.length)));
  const words = phrase.repeat(repeats);
  const ringSize = Math.min(ORBIT_TYPE.max, Math.max(ORBIT_TYPE.min, perimeter / (words.length * ORBIT_CHAR_EM)));

  const ringText = (pathId: string) => (
    <text
      className="font-display font-bold uppercase"
      fontSize={ringSize}
      fill={palette.accent}
      letterSpacing="0.06em"
    >
      <textPath href={`#${pathId}`} textLength={perimeter} lengthAdjust="spacing">
        {words}
      </textPath>
    </text>
  );
  const subjectHalf = rx * ORBIT_SUBJECT_SHARE;

  return (
    <ShareCardFrame format={format} palette={palette}>
      <svg aria-hidden="true" className="absolute inset-0" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <g transform={`rotate(${ORBIT_TILT} ${cx} ${cy})`} opacity={ORBIT_BACK_OPACITY}>
          <path id={`${id}-back`} d={ring} fill="none" />
          {ringText(`${id}-back`)}
        </g>
      </svg>
      <ShareCardSubject
        product={product}
        cutout={cutout}
        cardHeight={H}
        effect="float"
        box={{
          x: cx - subjectHalf,
          y: H * layout.subjectTop,
          width: subjectHalf * 2,
          height: H * (layout.subjectBottom - layout.subjectTop),
        }}
      />
      <svg aria-hidden="true" className="absolute inset-0" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <g transform={`rotate(${ORBIT_TILT} ${cx} ${cy})`}>
          <clipPath id={`${id}-front`}>
            <rect x={0} y={cy} width={W} height={H} />
          </clipPath>
          <path id={`${id}-path`} d={ring} fill="none" />
          <g clipPath={`url(#${id}-front)`}>{ringText(`${id}-path`)}</g>
        </g>
      </svg>
      <ShareCardStore product={product} className="absolute left-5 top-4" />
      <div className="absolute inset-x-5 bottom-4">
        <p className="font-display font-bold tracking-tight">
          <HeadlineLines lines={titleLines} sizes={sizes} />
        </p>
        <ShareCardPrice
          product={product}
          className="mt-2 font-display text-lg font-semibold"
          strikeClassName="text-xs"
        />
      </div>
    </ShareCardFrame>
  );
}

// ---------------------------------------------------------------------------
// STICKER: the product as a die-cut sticker on a dotted ground, its name on
// a tilted label and its price on a starburst.
// ---------------------------------------------------------------------------

const STICKER = {
  square: { subjectTop: 0.16, bottomGap: 36, burst: 88, titleSize: "text-2xl" },
  portrait: { subjectTop: 0.17, bottomGap: 40, burst: 96, titleSize: "text-3xl" },
  story: { subjectTop: 0.18, bottomGap: 60, burst: 112, titleSize: "text-4xl" },
} as const;

/** The ground's dot grid: its pitch and a dot's radius, in card pixels. */
const STICKER_DOTS = { pitch: 16, radius: 1.3 };

/** The product's tilt, in degrees. */
const STICKER_TILT = -5;

/** The starburst: how many points, and the inner radius against the outer. */
const STARBURST = { points: 16, inner: 0.8 };

/** A starburst's points in a 100 x 100 box. */
function starburstPoints(): string {
  const points: string[] = [];
  for (let i = 0; i < STARBURST.points * 2; i += 1) {
    const r = i % 2 === 0 ? 50 : 50 * STARBURST.inner;
    const a = (Math.PI * i) / STARBURST.points - Math.PI / 2;
    points.push(`${(50 + r * Math.cos(a)).toFixed(2)},${(50 + r * Math.sin(a)).toFixed(2)}`);
  }
  return points.join(" ");
}

const STARBURST_POINTS = starburstPoints();

function StickerCard({ product, format, cutout }: ShareCardTemplateProps) {
  const locale = useLocale();
  const H = heightOf(format);
  const layout = STICKER[format];
  const palette = shareCardPalette(cutout?.colour ?? null, "vivid", SHARE_CARD_FALLBACK_HUES.sun);
  const callout = useCallout(product);
  const priceText = usePriceText(product);
  const headline = headlineLines(product.title, 2, 24).join(" ").toLocaleUpperCase(locale);
  const subjectTop = H * layout.subjectTop;
  return (
    <ShareCardFrame
      format={format}
      palette={palette}
      style={{
        backgroundImage: `radial-gradient(${palette.soft} ${STICKER_DOTS.radius}px, transparent ${STICKER_DOTS.radius + 0.2}px)`,
        backgroundSize: `${STICKER_DOTS.pitch}px ${STICKER_DOTS.pitch}px`,
      }}
    >
      <ShareCardSubject
        product={product}
        cutout={cutout}
        cardHeight={H}
        effect="sticker"
        rotate={STICKER_TILT}
        frameClassName="border-4 border-white"
        box={{ x: PAD + 8, y: subjectTop, width: W - 2 * PAD - 16, height: H - layout.bottomGap - subjectTop }}
      />
      <p className="absolute left-4 right-14 top-5 -rotate-3 leading-snug">
        <span
          className={cn(
            "box-decoration-clone px-2.5 py-0.5 font-display font-bold tracking-tight",
            layout.titleSize,
          )}
          style={{ backgroundColor: palette.ink, color: palette.ground }}
        >
          {headline}
        </span>
      </p>
      <div
        data-share-callout={callout?.kind}
        className="absolute rotate-12"
        style={{ right: 14, bottom: 18, width: layout.burst, height: layout.burst }}
      >
        <svg viewBox="0 0 100 100" className="absolute inset-0 size-full drop-shadow-md" aria-hidden="true">
          <polygon points={STARBURST_POINTS} fill={BRAND_SURFACE} />
        </svg>
        <div className="relative flex size-full flex-col items-center justify-center text-center leading-none">
          {callout && (
            <span className="font-inter text-xs font-bold uppercase" style={{ color: palette.soft }}>
              {callout.label}
            </span>
          )}
          {!product.soldOut && <span className="mt-0.5 font-display text-xl font-bold">{priceText}</span>}
        </div>
      </div>
      <span className="absolute bottom-5 left-4 rotate-2 px-2 py-1 shadow-sm" style={{ backgroundColor: BRAND_SURFACE }}>
        <ShareCardStore product={product} />
      </span>
    </ShareCardFrame>
  );
}

// ---------------------------------------------------------------------------

export type ShareCardTemplateId = "masthead" | "echo" | "numerals" | "popout" | "orbit" | "sticker";

/** Every template, in the order a picker offers them. */
export const SHARE_CARD_TEMPLATES: readonly {
  id: ShareCardTemplateId;
  Component: ComponentType<ShareCardTemplateProps>;
}[] = [
  { id: "masthead", Component: MastheadCard },
  { id: "echo", Component: EchoCard },
  { id: "numerals", Component: NumeralsCard },
  { id: "popout", Component: PopoutCard },
  { id: "orbit", Component: OrbitCard },
  { id: "sticker", Component: StickerCard },
];
