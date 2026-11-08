"use client";

import { useEffect, useRef, useState } from "react";
import {
  BadgeCheck,
  Camera,
  MapPin,
  MessageSquare,
  ShoppingBag,
  Star,
  Store,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { cn } from "@/lib/utils";
import { BrandMarkIcon } from "@/components/ui/BrandMarkIcon";
import { formatFixed } from "@/lib/format/intl";
import { formatPrice } from "@/lib/format";
import type { Locale } from "@/i18n/locales";
import { StarRating } from "@/components/product-page/StarRating";
import { DURATION, EASE_STANDARD, POP } from "@/components/ui/motion-tokens";
import { easedPath } from "@/components/ui/story-motion";
import { cardClass } from "@/components/ui/surface-styles";
import {
  BrowserWindow,
  PAGE_DOMAIN,
  PRODUCT_PRICE,
  ProductPhoto,
  REVIEW_ROW_SIZE,
  STORY_REVIEWS,
  boxWithin,
  type Box,
  type Point,
  type StoryReview,
} from "./review-import-story-parts";
import {
  beamsLook,
  type BeamLayout,
  type BeamSource,
  type BeamTraveller,
  type ReviewImportBeamsLook,
} from "./review-import-beams-tokens";

/** The app's own ink, on a tile and as light. */
const INK = { tile: "bg-foreground text-background", light: "text-foreground" } as const;

/**
 * Each platform: its name (a name, not copy); its `plain` mark (an icon for
 * what kind of place it is, never anything like the company's logo); its
 * `lettered` mark and the colours it is known by (the tile, and the light its
 * beam carries), which read like the company's own logo; and the reviews it
 * brings: how many, and their average. Literal classes, so Tailwind finds them.
 */
const SOURCES: Record<
  BeamSource,
  { name: string; plain: LucideIcon; lettered: string | LucideIcon; tile: string; light: string; count: number; rating: number }
> = {
  judgeme: { name: "Judge.me", plain: BadgeCheck, lettered: "J", ...INK, count: 41, rating: 4.8 },
  loox: { name: "Loox", plain: Camera, lettered: "L", ...INK, count: 28, rating: 4.9 },
  yotpo: { name: "Yotpo", plain: MessageSquare, lettered: "Y", ...INK, count: 19, rating: 4.7 },
  shopify: {
    name: "Shopify",
    plain: Store,
    lettered: ShoppingBag,
    tile: "bg-place-store text-background",
    light: "text-place-store",
    count: 52,
    rating: 4.8,
  },
  google: {
    name: "Google",
    plain: MapPin,
    lettered: "G",
    tile: "bg-background text-place-maps ring-1 ring-border",
    light: "text-place-maps",
    count: 37,
    rating: 4.7,
  },
  etsy: {
    name: "Etsy",
    plain: ShoppingBag,
    lettered: "E",
    tile: "bg-place-marketplace text-background",
    light: "text-place-marketplace",
    count: 24,
    rating: 4.9,
  },
  facebook: {
    name: "Facebook",
    plain: Users,
    lettered: "f",
    tile: "bg-place-social text-background",
    light: "text-place-social",
    count: 15,
    rating: 4.6,
  },
  trustpilot: {
    name: "Trustpilot",
    plain: Star,
    lettered: Star,
    tile: "bg-place-review-site text-background",
    light: "text-place-review-site",
    count: 9,
    rating: 4.8,
  },
};

/** A plain mark's tile: the app's paper with an ink icon, so no company's colours come with it. */
const PLAIN_TILE = "bg-background text-foreground ring-1 ring-border";

/** The light of every beam in the `acid` glow: the app's purple accent. */
const ACID_LIGHT = "text-acid";

/** A mark's sizes: alone as a token, inside a named chip, and as the badge on a landed review's face. */
const MARK_SIZES = {
  token: { box: "size-11 shadow-md", glyph: "text-lg", icon: "size-5" },
  chip: { box: "size-7", glyph: "text-sm", icon: "size-3.5" },
  badge: { box: "size-4 ring-2 ring-background", glyph: "text-xs", icon: "size-2.5" },
} as const;

/** The beams' resting line, under the light that travels it: solid, or (`dots`) darker so its dots read. */
const BEAM_LINE = { line: "stroke-foreground/15", dots: "stroke-foreground/25" } as const;
/** The dotted beam's rhythm (px): a dot, then this gap; it flows a whole beat of gaps a second towards the page. */
const DOT_GAP = 6;
/** The travelling light's glow, around the light's own colour. */
const BEAM_GLOW = "drop-shadow(0 0 4px currentColor)";
/** How much of a beam the travelling light covers, as a share of the beam. */
const LIGHT_LENGTH = 0.38;
/** Line widths (px): the resting line, its dots, and the travelling light. */
const LIGHT_WIDTH = { line: 1.5, dots: 2, light: 3 } as const;
/** The ring the product page gives where a batch lands (px): from, to. */
const LANDING_RING = { from: 3, to: 14 } as const;
/** A platform's kick as it sends: up, and back. */
const SEND_KICK = [1, 1.1, 1] as const;
/** Where on the product page the beams arrive, as a share of its height: beside its reviews. */
const ENTRY_Y = 0.62;
/** How far apart the beams arrive (px), so they meet as a bundle rather than one line. */
const BEAM_SPREAD = 6;
/** How far the `arc` layout bows its middle platforms towards the page (px). */
const ARC_BOW = 40;
/** Narrower than this (px: the stage's @md, 28rem) and every layout draws as `stack`. */
const NARROW_PX = 448;
/** How many reviews the product page lists at once, newest first. */
const VISIBLE_REVIEWS = 3;
/** The list's height: VISIBLE_REVIEWS rows of REVIEW_ROW_SIZE (h-12 each). */
const REVIEW_LIST_HEIGHT = "h-36";
/** A landed row's face centre, from the row's corner (px): its size-7 face, on the left of an h-12 row. */
const ROW_FACE = { x: 14, y: 24 } as const;
/** The `stack` row of platforms, a column each (BEAM_SOURCE_COUNT is 2 to 4). Literal classes, so Tailwind finds them. */
const STACK_COLUMNS: Record<number, string> = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" };
/** Points a traveller's journey along a beam is drawn through. */
const JOURNEY_STEPS = 24;
/** A docking review's share of the trip spent on the beam; the rest it glides into its row. */
const DOCK_SPLIT = 0.8;
/** A stream: how many faces each platform sends, and the share of the trip between one and the next. */
const STREAM = { faces: 3, gap: 0.16 } as const;

/**
 * Where a traveller is held from: its middle, or the face it carries (so the
 * face rides the line and docks onto the face of its row): the pill's 2px or
 * the card's 6px padding plus half a size-7 face.
 */
const TRAVELLER_ANCHOR: Record<Exclude<BeamTraveller, "pulse">, string> = {
  count: "-translate-x-1/2",
  review: "-translate-x-4",
  card: "-translate-x-5",
  stream: "-translate-x-1/2",
};

/** The beats' lengths (ms), before `pace`. */
const BEAT_MS = { rest: 700, travel: 1100, gap: 300, hold: 2400, clear: 700 } as const;

/** One beat: the platforms whose light is on its way, and how many have landed (in order). */
type Beat = { ms: number; flying: number[]; landed: number };

/**
 * THE STORY, beat by beat: a rest, then each platform sends its reviews along
 * its beam to the product page (one after another, or all at once), the
 * page's count rolling up as each lands; a hold, and the page clears for the next take.
 */
function beamBeats(look: ReviewImportBeamsLook, count: number): Beat[] {
  const all = Array.from({ length: count }, (_, index) => index);
  const beats: Beat[] = [{ ms: BEAT_MS.rest, flying: [], landed: 0 }];
  if (look.carry === "together") {
    beats.push({ ms: BEAT_MS.travel, flying: all, landed: 0 });
  } else {
    for (const index of all) {
      beats.push({ ms: BEAT_MS.travel, flying: [index], landed: index }, { ms: BEAT_MS.gap, flying: [], landed: index + 1 });
    }
  }
  beats.push({ ms: BEAT_MS.hold, flying: [], landed: count }, { ms: BEAT_MS.clear, flying: [], landed: 0 });
  return beats.map((beat) => ({ ...beat, ms: beat.ms * look.pace }));
}

/** A beam: where it starts, where it lands, and the curve between. */
type Beam = { from: Point; to: Point; c1: Point; c2: Point };

/** The beam from `from` to `to`, leaving and arriving level (or, falling, upright). */
function beamBetween(from: Point, to: Point, falling: boolean): Beam {
  if (falling) {
    const bend = (to.y - from.y) / 2;
    return { from, to, c1: { x: from.x, y: from.y + bend }, c2: { x: to.x, y: to.y - bend } };
  }
  const bend = (to.x - from.x) / 2;
  return { from, to, c1: { x: from.x + bend, y: from.y }, c2: { x: to.x - bend, y: to.y } };
}

const beamPath = ({ from, c1, c2, to }: Beam) => `M ${from.x} ${from.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`;

/** The point `t` (0 to 1) along a beam's curve. */
function beamPoint({ from, c1, c2, to }: Beam, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * from.x + b * c1.x + c * c2.x + d * to.x, y: a * from.y + b * c1.y + c * c2.y + d * to.y };
}

/** The points a traveller passes through along a beam, kept in pace with the light (see easedPath). */
const journey = (beam: Beam): Point[] => easedPath((t) => beamPoint(beam, t), JOURNEY_STEPS);

/** How a look draws a platform: its tile and its light. */
type Paint = Pick<ReviewImportBeamsLook, "marks" | "colour" | "glow">;

function tileOf(source: BeamSource, paint: Paint) {
  if (paint.marks === "plain") return PLAIN_TILE;
  return paint.colour === "brand" ? SOURCES[source].tile : INK.tile;
}

function lightOf(source: BeamSource, paint: Paint) {
  if (paint.glow === "acid") return ACID_LIGHT;
  return paint.marks === "lettered" && paint.colour === "brand" ? SOURCES[source].light : INK.light;
}

/** A platform's round mark, at `size`: its plain icon, or its letter (or icon) on its tile. */
function SourceMark({ source, paint, size }: { source: BeamSource; paint: Paint; size: keyof typeof MARK_SIZES }) {
  const Glyph = paint.marks === "plain" ? SOURCES[source].plain : SOURCES[source].lettered;
  const sizes = MARK_SIZES[size];
  const filled = paint.marks === "lettered" && Glyph === Star;
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-full", sizes.box, tileOf(source, paint))}>
      {typeof Glyph === "string" ? (
        <span className={cn("font-display font-bold leading-none", sizes.glyph)}>{Glyph}</span>
      ) : (
        <Glyph className={cn(sizes.icon, filled && "fill-current")} strokeWidth={filled ? 0 : 2.25} />
      )}
    </span>
  );
}

/** A platform where its reviews leave from: its mark with its name beside it (or, `upright`, under it), or the mark alone. */
function SourceChip({
  source,
  paint,
  labels,
  upright,
  chipRef,
}: {
  source: BeamSource;
  paint: Paint;
  labels: boolean;
  upright: boolean;
  chipRef: (node: HTMLSpanElement | null) => void;
}) {
  if (!labels) {
    return (
      <span ref={chipRef} className="flex w-fit rounded-full">
        <SourceMark source={source} paint={paint} size="token" />
      </span>
    );
  }
  if (upright) {
    return (
      <span ref={chipRef} className="flex min-w-0 flex-col items-center gap-1">
        <SourceMark source={source} paint={paint} size="token" />
        <span className="max-w-full truncate font-inter text-xs font-medium text-foreground">{SOURCES[source].name}</span>
      </span>
    );
  }
  return (
    <span
      ref={chipRef}
      className="flex w-fit min-w-0 items-center gap-2 rounded-full bg-background py-1 pl-1 pr-3 shadow-sm ring-1 ring-border"
    >
      <SourceMark source={source} paint={paint} size="chip" />
      <span className="truncate font-inter text-xs font-medium text-foreground">{SOURCES[source].name}</span>
    </span>
  );
}

/** A reviewer's face, with the badge of the platform the review came from. */
function Face({ review, source, paint }: { review: StoryReview; source: BeamSource; paint: Paint }) {
  return (
    <span className="relative shrink-0">
      {/* Decorative, inside an aria-hidden stage: no alt text, and too small for next/image to earn its keep. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={review.photo} alt="" width={28} height={28} className="size-7 rounded-full bg-secondary" />
      <span className="absolute -bottom-0.5 -right-1">
        <SourceMark source={source} paint={paint} size="badge" />
      </span>
    </span>
  );
}

/** Stars that wrap out of sight, whole, where they do not fit beside a name. */
function NameAndStars({ review }: { review: StoryReview }) {
  return (
    <span className="flex h-6 min-w-0 flex-wrap items-center gap-x-1.5 overflow-hidden">
      <span className="shrink-0 font-inter text-xs leading-6 font-medium text-foreground">{review.name}</span>
      <span className="text-rating">
        <StarRating value={review.rating} label="" />
      </span>
    </span>
  );
}

/**
 * What rides a beam with its light: the platform's mark and how many reviews
 * it brings; one of them as a face and stars; one as a small card with its
 * words; or (in a stream) a reviewer's face alone.
 */
function Traveller({
  source,
  review,
  paint,
  kind,
}: {
  source: BeamSource;
  review: StoryReview;
  paint: Paint;
  kind: Exclude<BeamTraveller, "pulse">;
}) {
  const t = useTranslations("Products.reviewImport.story");
  const locale = useLocale() as Locale;
  const held = cn("flex -translate-y-1/2 items-center whitespace-nowrap bg-background shadow-md ring-1 ring-border", TRAVELLER_ANCHOR[kind]);
  switch (kind) {
    case "count":
      return (
        <span className={cn(held, "gap-1 rounded-full py-0.5 pl-0.5 pr-2")}>
          <SourceMark source={source} paint={paint} size="chip" />
          <span className="font-inter text-xs font-semibold tabular-nums text-foreground">
            +{formatFixed(SOURCES[source].count, 0, locale)}
          </span>
        </span>
      );
    case "review":
      return (
        <span className={cn(held, "gap-1 rounded-full py-0.5 pl-0.5 pr-2")}>
          <Face review={review} source={source} paint={paint} />
          <span className="text-rating">
            <StarRating value={review.rating} label="" />
          </span>
        </span>
      );
    case "card":
      return (
        <span className={cn(held, "gap-2 rounded-lg p-1.5 pr-3")}>
          <Face review={review} source={source} paint={paint} />
          <span className="flex w-36 min-w-0 flex-col">
            <NameAndStars review={review} />
            <span className="truncate font-inter text-xs text-muted-foreground">{t(`reviews.${review.id}`)}</span>
          </span>
        </span>
      );
    case "stream":
      return (
        <span className={cn(held, "rounded-full p-0.5")}>
          <Face review={review} source={source} paint={paint} />
        </span>
      );
  }
}

/** A review as the product page lists it: face (with its platform's badge), name, stars, words. */
function LandedReview({ review, source, paint }: { review: StoryReview; source: BeamSource; paint: Paint }) {
  const t = useTranslations("Products.reviewImport.story");
  return (
    <div className={cn(REVIEW_ROW_SIZE, "flex items-center gap-2.5 border-b border-border bg-background")}>
      <Face review={review} source={source} paint={paint} />
      <span className="flex min-w-0 flex-1 flex-col">
        <NameAndStars review={review} />
        <span className="truncate font-inter text-xs text-muted-foreground">{t(`reviews.${review.id}`)}</span>
      </span>
    </div>
  );
}

/** The measured stage: its size, each beam, and where a docking review settles (the top row's face). */
type Layout = { width: number; height: number; beams: Beam[]; dock: Point };

/** Which side of the product page each platform sits on in `layout`: the first half left, the rest right in `sides`. */
const onRight = (layout: BeamLayout, index: number, count: number) => layout === "sides" && index >= Math.ceil(count / 2);

/** How far the `arc` layout bows platform `index` of `count` towards the page (px): most in the middle. */
const arcBow = (index: number, count: number) => Math.round(Math.sin((Math.PI * (index + 0.5)) / count) * ARC_BOW);

/**
 * THE REVIEW IMPORT'S BEAMS GRAPHIC: reviews come from many places and land
 * on one product page. Each platform is a round mark with its name; a beam
 * curves from each to the product page, light runs along it carrying the
 * platform's reviews, and the page's rating and count fill in as each batch
 * lands, every review keeping its platform's badge.
 *
 * `look` (review-import-beams-tokens) picks the platforms, where they sit,
 * what travels and how it is drawn. Loops while the page is open; under
 * reduced motion it is the landed frame, still. Illustrative, so all of it is
 * hidden from assistive tech.
 */
export function ReviewImportBeams({ look: given }: { look?: Partial<ReviewImportBeamsLook> }) {
  const look = beamsLook(given);
  const t = useTranslations("Products.reviewImport.story");
  const tReviews = useTranslations("ProductPage.reviews");
  const locale = useLocale() as Locale;
  const still = useReducedMotion() ?? false;
  const [beats, setBeats] = useState(0);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [narrow, setNarrow] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef<(HTMLSpanElement | null)[]>([]);

  const { sources, labels, traveller } = look;
  const paint: Paint = { marks: look.marks, colour: look.colour, glow: look.glow };
  const count = sources.length;
  const sourcesKey = sources.join();
  const drawn: BeamLayout = narrow ? "stack" : look.layout;
  const falling = drawn === "stack";
  const story = beamBeats(look, count);
  const beat = still ? { ms: 0, flying: [], landed: count } : story[beats % story.length];
  const travel = (BEAT_MS.travel * look.pace) / 1000;
  // A face or card can glide on into its row; the light runs the beam in the time it spends there.
  const docks = look.landing === "dock" && (traveller === "review" || traveller === "card");
  const onBeam = travel * (docks ? DOCK_SPLIT : 1);

  useEffect(() => {
    if (still) return;
    const id = window.setTimeout(() => setBeats(beats + 1), beat.ms);
    return () => window.clearTimeout(id);
  }, [still, beats, beat.ms]);

  // Where each platform, the product page and its list are, measured: they move
  // with the stage's width, and under NARROW_PX the whole layout turns to `stack`.
  useEffect(() => {
    const stage = stageRef.current;
    const page = pageRef.current;
    const list = listRef.current;
    if (!stage || !page || !list || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      setNarrow(stage.offsetWidth < NARROW_PX);
      const chips = chipRefs.current.slice(0, count);
      if (chips.some((chip) => !chip)) return;
      const card = boxWithin(page, stage);
      const rows = boxWithin(list, stage);
      const beams = (chips as HTMLSpanElement[]).map((chip, index) => {
        const box: Box = boxWithin(chip, stage);
        const spread = (index - (count - 1) / 2) * BEAM_SPREAD;
        if (falling) {
          return beamBetween({ x: box.x + box.width / 2, y: box.y + box.height }, { x: card.x + card.width / 2 + spread, y: card.y }, true);
        }
        const right = onRight(drawn, index, count);
        const entry = { x: right ? card.x + card.width : card.x, y: card.y + card.height * ENTRY_Y + spread };
        return beamBetween({ x: right ? box.x : box.x + box.width, y: box.y + box.height / 2 }, entry, false);
      });
      setLayout({
        width: stage.offsetWidth,
        height: stage.offsetHeight,
        beams,
        dock: { x: rows.x + ROW_FACE.x, y: rows.y + ROW_FACE.y },
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [count, sourcesKey, labels, drawn, falling]);

  // The page's count rolls up as each batch lands, and back to nothing between takes.
  const landed = sources.slice(0, beat.landed);
  const total = landed.reduce((sum, source) => sum + SOURCES[source].count, 0);
  const average = total ? landed.reduce((sum, source) => sum + SOURCES[source].count * SOURCES[source].rating, 0) / total : 0;
  const counted = useMotionValue(still ? total : 0);
  const countText = useTransform(counted, (value) => formatFixed(Math.round(value), 0, locale));
  useEffect(() => {
    const controls = animate(counted, total, total ? { duration: travel * 0.6, ease: EASE_STANDARD } : { duration: 0 });
    return () => controls.stop();
  }, [counted, total, travel]);

  const chipRef = (index: number) => (node: HTMLSpanElement | null) => {
    chipRefs.current[index] = node;
  };
  const chip = (source: BeamSource, index: number) => (
    <motion.span
      key={source}
      className="flex min-w-0"
      // The arc bows the column with a margin, not a transform, so the beams measure it.
      style={drawn === "arc" ? { marginLeft: arcBow(index, count) } : undefined}
      initial={false}
      animate={{ scale: beat.flying.includes(index) && !still ? [...SEND_KICK] : 1 }}
      transition={{ duration: DURATION.slow * 1.5, ease: EASE_STANDARD }}
    >
      <SourceChip source={source} paint={paint} labels={labels} upright={falling} chipRef={chipRef(index)} />
    </motion.span>
  );
  const newestFirst = landed.map((source, index) => ({ source, review: STORY_REVIEWS[index] })).reverse().slice(0, VISIBLE_REVIEWS);

  /** One rider on beam `index`: `review` setting off `delay` into the trip and taking `duration`, docking or fading at the page. */
  const rider = (index: number, review: StoryReview, kind: Exclude<BeamTraveller, "pulse">, key: string, delay = 0, duration = travel) => {
    if (!layout) return null;
    const along = journey(layout.beams[index]);
    const docking = docks && kind !== "stream";
    const points = docking ? [...along, layout.dock] : along;
    const times = docking ? [...along.map((_, step) => (step / JOURNEY_STEPS) * DOCK_SPLIT), 1] : undefined;
    const fades = { duration, delay, times: [0, 0.25, docking ? 0.96 : 0.85, 1] };
    return (
      <motion.span
        key={key}
        className="pointer-events-none absolute left-0 top-0"
        initial={{ x: points[0].x, y: points[0].y, opacity: 0, scale: 0.8 }}
        animate={{
          x: points.map((point) => point.x),
          y: points.map((point) => point.y),
          opacity: [0, 1, 1, 0],
          scale: [0.8, 1, 1, docking ? 1 : 0.8],
        }}
        transition={{
          x: { duration, delay, ease: "linear", times },
          y: { duration, delay, ease: "linear", times },
          // It appears clear of its platform's mark; it fades into the page, or into its row.
          opacity: fades,
          scale: fades,
        }}
      >
        <Traveller source={sources[index]} review={review} paint={paint} kind={kind} />
      </motion.span>
    );
  };

  const productPage = (
    <div ref={pageRef} className={cn("min-w-0", falling ? "w-full" : drawn === "sides" ? "w-5/12" : "w-1/2")}>
      <BrowserWindow tabs={[{ key: "page", favicon: <BrandMarkIcon className="size-3 text-foreground" />, title: t("product") }]} domain={PAGE_DOMAIN}>
        <div className="flex flex-col p-3">
          <div className="flex gap-3">
            <ProductPhoto className="size-14" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate font-inter text-xs font-semibold text-foreground">{t("product")}</span>
              <span className="font-inter text-xs text-muted-foreground">{formatPrice(PRODUCT_PRICE, "EUR", locale)}</span>
              {/* The rating fills in as the batches land; the count rolls up to match. */}
              <span className="flex h-4 min-w-0 flex-wrap items-center gap-x-1.5 overflow-hidden font-inter text-xs leading-4">
                <motion.span
                  className={total ? "text-rating" : "text-muted-foreground"}
                  initial={false}
                  animate={{ opacity: total ? 1 : 0.5 }}
                  transition={{ duration: DURATION.slow, ease: EASE_STANDARD }}
                >
                  <StarRating value={average} label="" />
                </motion.span>
                {total > 0 && <span className="font-medium text-foreground">{formatFixed(average, 1, locale)}</span>}
                <span className="tabular-nums text-muted-foreground">
                  (<motion.span>{countText}</motion.span>)
                </span>
              </span>
            </div>
          </div>
          <span className="mb-1 mt-3 font-inter text-xs font-semibold text-foreground">{tReviews("heading")}</span>
          {/* Newest first; an empty, dashed list until the first batch lands. */}
          <div ref={listRef} className={cn("relative overflow-hidden", REVIEW_LIST_HEIGHT)}>
            <motion.span
              className="absolute inset-0 rounded-md border border-dashed border-border"
              initial={false}
              animate={{ opacity: total ? 0 : 1 }}
              transition={{ duration: DURATION.base, ease: EASE_STANDARD }}
            />
            <AnimatePresence initial={false} mode="popLayout">
              {newestFirst.map(({ source, review }) => (
                <motion.div
                  key={source}
                  layout
                  // A docked review is already where its row goes, so the row only fades up around it.
                  initial={docks ? { opacity: 0 } : { opacity: 0, y: -12, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, transition: { duration: DURATION.slow, ease: EASE_STANDARD } }}
                  transition={POP}
                >
                  <LandedReview review={review} source={source} paint={paint} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </BrowserWindow>
    </div>
  );

  const left = drawn === "sides" ? sources.slice(0, Math.ceil(count / 2)) : sources;
  const right = drawn === "sides" ? sources.slice(Math.ceil(count / 2)) : [];

  return (
    <div
      ref={stageRef}
      aria-hidden="true"
      data-review-import-beams={still ? "still" : "playing"}
      data-review-import-beams-layout={drawn}
      className={cn(cardClass, "@container relative overflow-hidden bg-secondary")}
    >
      {/* The beams, under everything: a faint line from each platform to the page, and the light running along it. */}
      {layout && (
        <svg
          className="pointer-events-none absolute inset-0"
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          fill="none"
        >
          {layout.beams.map((beam, index) =>
            look.line === "dots" ? (
              <motion.path
                key={`line-${sources[index]}`}
                d={beamPath(beam)}
                className={BEAM_LINE.dots}
                strokeWidth={LIGHT_WIDTH.dots}
                strokeLinecap="round"
                strokeDasharray={`0 ${DOT_GAP}`}
                // The dots flow towards the page, a gap at a time.
                animate={still ? undefined : { strokeDashoffset: [0, -DOT_GAP * 2] }}
                transition={{ duration: 1, ease: "linear", repeat: Infinity }}
              />
            ) : (
              <path key={`line-${sources[index]}`} d={beamPath(beam)} className={BEAM_LINE.line} strokeWidth={LIGHT_WIDTH.line} strokeLinecap="round" />
            ),
          )}
          {layout.beams.map((beam, index) =>
            beat.flying.includes(index) && !still ? (
              <motion.path
                key={`light-${sources[index]}-${beats}`}
                d={beamPath(beam)}
                pathLength={1}
                className={lightOf(sources[index], paint)}
                stroke="currentColor"
                strokeWidth={LIGHT_WIDTH.light}
                strokeLinecap="round"
                strokeDasharray={`${LIGHT_LENGTH} ${1 + LIGHT_LENGTH}`}
                style={{ filter: BEAM_GLOW }}
                initial={{ strokeDashoffset: LIGHT_LENGTH, opacity: 1 }}
                animate={{ strokeDashoffset: LIGHT_LENGTH - 1, opacity: [1, 1, 0] }}
                transition={{ duration: onBeam, ease: EASE_STANDARD, opacity: { duration: onBeam, times: [0, 0.85, 1] } }}
              />
            ) : null,
          )}
          {/* Where a batch lands, the page answers with a ring in the light's colour. */}
          {layout.beams.map((beam, index) =>
            beat.flying.includes(index) && !still ? (
              <motion.circle
                key={`ring-${sources[index]}-${beats}`}
                cx={beam.to.x}
                cy={beam.to.y}
                className={lightOf(sources[index], paint)}
                stroke="currentColor"
                strokeWidth={LIGHT_WIDTH.line}
                initial={{ r: LANDING_RING.from, opacity: 0 }}
                animate={{ r: LANDING_RING.to, opacity: [0, 0.8, 0] }}
                transition={{ delay: onBeam * 0.85, duration: DURATION.slow * 2, ease: EASE_STANDARD }}
              />
            ) : null,
          )}
        </svg>
      )}

      {falling ? (
        <div className="relative flex flex-col gap-10 p-3">
          <div className={cn("grid gap-2", STACK_COLUMNS[count])}>
            {sources.map((source, index) => (
              <span key={source} className="flex min-w-0 justify-center">
                {chip(source, index)}
              </span>
            ))}
          </div>
          {productPage}
        </div>
      ) : (
        <div className="relative flex items-stretch justify-between gap-6 p-3 @md:p-4">
          <div className="flex min-w-0 flex-col items-start justify-around">{left.map((source, index) => chip(source, index))}</div>
          {productPage}
          {drawn === "sides" && (
            <div className="flex min-w-0 flex-col items-end justify-around">
              {right.map((source, index) => chip(source, left.length + index))}
            </div>
          )}
        </div>
      )}

      {/* What rides each beam with its light: one traveller, or a stream of faces. */}
      {layout &&
        traveller !== "pulse" &&
        !still &&
        layout.beams.flatMap((_, index) => {
          if (!beat.flying.includes(index)) return [];
          if (traveller !== "stream") return [rider(index, STORY_REVIEWS[index], traveller, `ride-${sources[index]}-${beats}`)];
          const each = travel * (1 - STREAM.gap * (STREAM.faces - 1));
          return Array.from({ length: STREAM.faces }, (_, face) =>
            rider(
              index,
              STORY_REVIEWS[(index + face) % STORY_REVIEWS.length],
              "stream",
              `ride-${sources[index]}-${beats}-${face}`,
              travel * STREAM.gap * face,
              each,
            ),
          );
        })}
    </div>
  );
}
