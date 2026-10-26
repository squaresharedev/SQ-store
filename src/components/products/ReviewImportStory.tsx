"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ChevronLeft, ChevronRight, Lock, MousePointer2, RotateCw, Globe } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { BRAND_MARK } from "@/lib/brand";
import { formatFixed } from "@/lib/format/intl";
import { formatPrice } from "@/lib/format";
import type { Locale } from "@/i18n/locales";
import { StarRating } from "@/components/product-page/StarRating";
import { DURATION, EASE_ENTRANCE, EASE_STANDARD, POP, PRESS_SCALE } from "@/components/ui/motion-tokens";
import { cardClass, placeholderBarClass } from "@/components/ui/surface-styles";

/** The reviews being carried over. Names and photos are people, not copy; the quotes are. */
const REVIEWS = [
  { id: "a", name: "Rafael M.", rating: 5, photo: "/review-import/reviewer-1.webp" },
  { id: "b", name: "Tomás R.", rating: 5, photo: "/review-import/reviewer-2.webp" },
  { id: "c", name: "Jonas B.", rating: 4, photo: "/review-import/reviewer-3.webp" },
] as const;

/** Their average, as the product page shows it once they land. */
const AVERAGE = REVIEWS.reduce((sum, review) => sum + review.rating, 0) / REVIEWS.length;

/** The made-up product the reviews land on: a mug, priced in the store currency. */
const PRODUCT_PRICE = 24;

/** The address of the store the reviews are leaving: a stand-in, since it is
 *  whatever store the seller comes from. A domain, not copy. */
const OTHER_DOMAIN = "yourdomain.com";
/** Where the product page lives. A domain, not copy. */
const PAGE_DOMAIN = "squareshare.eu";

/** One review row's box, shared by the row, its place in the old store and the slot it lands in. */
const REVIEW_ROW_SIZE = "h-12 w-full";

/** The three window controls of a drawn browser, in their own colours. */
const WINDOW_DOTS = ["bg-window-close", "bg-window-minimize", "bg-window-zoom"] as const;

/** Where the list is: in the old store, picked up, carried, landed, or gone for the next take. */
type ListState = "rest" | "lifted" | "carried" | "landed" | "gone";

/** Where the cursor is heading. */
type CursorTarget = "rest" | "list" | "drop";

/**
 * THE STORY, beat by beat. The cursor goes to the review list in the old
 * store, picks the whole list up, carries it across to the product page and
 * lets go; the list settles into the page's reviews while its rating fills
 * in. The last beat clears it for the next take.
 */
const STORY: readonly { list: ListState; cursor: CursorTarget; press: boolean; ms: number }[] = [
  { list: "rest", cursor: "rest", press: false, ms: 1000 },
  { list: "rest", cursor: "list", press: false, ms: 850 },
  { list: "lifted", cursor: "list", press: true, ms: 320 },
  { list: "carried", cursor: "drop", press: true, ms: 1000 },
  { list: "landed", cursor: "drop", press: false, ms: 700 },
  { list: "landed", cursor: "rest", press: false, ms: 2600 },
  { list: "gone", cursor: "rest", press: false, ms: 400 },
];

/** The beat a still picture shows: everything landed, cursor out of the way. */
const LANDED_BEAT = 5;

/** Travel across the stage: slower than a state change. */
const GLIDE = { duration: 0.7, ease: EASE_STANDARD };
/** How far the list rises when it is picked up (px). */
const LIFT = 3;
/** The selection outline's margin around the list it holds (px). */
const SELECTION_INSET = 6;
/** Where the cursor rests, as a fraction of the stage: low, between the windows. */
const REST = { x: 0.5, y: 0.92 };
/** The pointer's tip sits this far inside its own box (px). */
const CURSOR_TIP = 3;
/** Where on the list the cursor grabs it, as a fraction of the list. */
const AIM = { x: 0.78, y: 0.55 };

type Box = { x: number; y: number; width: number; height: number };
type Layout = { rows: Box[]; slots: Box[]; rest: { x: number; y: number } };

/** `node`'s box in `root`'s coordinates. Offsets, not bounding rects, so a
 *  transform on the way (the list lifting) never moves the measurement. */
function boxWithin(node: HTMLElement, root: HTMLElement): Box {
  let x = 0;
  let y = 0;
  for (let el: HTMLElement | null = node; el && el !== root; el = el.offsetParent as HTMLElement | null) {
    x += el.offsetLeft;
    y += el.offsetTop;
  }
  return { x, y, width: node.offsetWidth, height: node.offsetHeight };
}

/** The box around a list of rows. */
function around(rows: Box[]): Box {
  const first = rows[0];
  const last = rows[rows.length - 1];
  return { x: first.x, y: first.y, width: first.width, height: last.y + last.height - first.y };
}

/** The point the cursor holds a list by. */
function grip(box: Box): { x: number; y: number } {
  return { x: box.x + box.width * AIM.x, y: box.y + box.height * AIM.y };
}

/**
 * A drawn browser window, close enough to a real one to tell two sites apart:
 * window controls, a tab with the site's icon and title, back, forward and
 * reload, and the padlocked address.
 */
function BrowserWindow({
  favicon,
  tab,
  domain,
  children,
}: {
  favicon: ReactNode;
  tab: string;
  domain: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm">
      <div className="flex items-end gap-2 bg-secondary px-2 pt-1.5">
        <div className="flex gap-1 pb-2">
          {WINDOW_DOTS.map((dot) => (
            <span key={dot} className={cn("size-2 rounded-full", dot)} />
          ))}
        </div>
        <span className="flex min-w-0 max-w-full items-center gap-1.5 rounded-t-md bg-background px-2 py-1 font-inter text-xs text-foreground">
          {favicon}
          <span className="truncate">{tab}</span>
        </span>
      </div>
      <div className="flex items-center gap-1 border-b border-border px-2 py-1 text-muted-foreground">
        <ChevronLeft className="size-3 shrink-0" strokeWidth={2} />
        <ChevronRight className="size-3 shrink-0 opacity-40" strokeWidth={2} />
        <RotateCw className="size-3 shrink-0" strokeWidth={2} />
        <span className="ml-1 flex min-w-0 flex-1 items-center gap-1 rounded-full bg-secondary px-2 py-0.5 font-inter text-xs">
          <Lock className="size-2.5 shrink-0" strokeWidth={2} />
          <span className="truncate">{domain}</span>
        </span>
      </div>
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}

/** The product photo: a real one, a hand-painted mug (CC0, WordPress Photo Directory). */
const PRODUCT_PHOTO = "/review-import/mug.webp";

/** The mug's photo, as both stores show it. */
function ProductPhoto() {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- decorative, inside an aria-hidden stage
    <img
      src={PRODUCT_PHOTO}
      alt=""
      width={80}
      height={80}
      className="size-16 shrink-0 rounded-sm bg-secondary object-cover @md:size-20"
    />
  );
}

/** One review as a store lists it: who (with their photo), how many stars,
 *  what they said, and a hairline under every row but the last. */
function ReviewRow({
  name,
  photo,
  rating,
  quote,
  last,
}: {
  name: string;
  photo: string;
  rating: number;
  quote: string;
  last: boolean;
}) {
  return (
    <div className={cn(REVIEW_ROW_SIZE, "flex items-center gap-2 bg-background", !last && "border-b border-border")}>
      {/* Decorative, inside an aria-hidden stage: no alt text, and too small for next/image to earn its keep. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photo} alt="" width={28} height={28} className="size-7 shrink-0 rounded-full bg-secondary" />
      <span className="flex min-w-0 flex-1 flex-col">
        {/* The name keeps its width; the stars give way on a narrow page. */}
        <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
          <span className="shrink-0 font-inter text-xs font-medium text-foreground">{name}</span>
          <span className="text-rating">
            <StarRating value={rating} label="" />
          </span>
        </span>
        <span className="truncate font-inter text-xs text-muted-foreground">{quote}</span>
      </span>
    </div>
  );
}

/** Where each review row sits (in the old store, or its slot on the page), measured by ref. */
function ReviewRows({ refs }: { refs: RefObject<(HTMLDivElement | null)[]> }) {
  return (
    <div className="flex flex-col">
      {REVIEWS.map((review, index) => (
        <div
          key={review.id}
          ref={(node) => {
            refs.current[index] = node;
          }}
          className={REVIEW_ROW_SIZE}
        />
      ))}
    </div>
  );
}

/**
 * THE MOTION GRAPHIC ON THE REVIEW IMPORT: what the page does, shown. A cursor
 * picks up the review list on the store the seller is leaving, all of it at
 * once, carries it to a product page on Square Share and lets go; the reviews
 * settle into the page's review list and its rating fills in.
 *
 * Two websites side by side, each in a browser window with its own tab and
 * address: the same mug on a made-up shop the seller is leaving, and on
 * Square Share. Loops while the page is open; under reduced motion it is the
 * landed frame, still.
 * Illustrative, so all of it is hidden from assistive tech. Same choreography
 * as BuyButtonStory.
 */
export function ReviewImportStory() {
  const t = useTranslations("Products.reviewImport.story");
  const tBuy = useTranslations("Products.buyButton");
  const tReviews = useTranslations("ProductPage.reviews");
  const locale = useLocale() as Locale;
  const still = useReducedMotion() ?? false;
  // Beats played; the beat on screen is its remainder.
  const [beats, setBeats] = useState(0);
  const [layout, setLayout] = useState<Layout | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const slotRefs = useRef<(HTMLDivElement | null)[]>([]);

  const beat = STORY[still ? LANDED_BEAT : beats % STORY.length];

  useEffect(() => {
    if (still) return;
    const id = window.setTimeout(() => setBeats(beats + 1), beat.ms);
    return () => window.clearTimeout(id);
  }, [still, beats, beat.ms]);

  // Where the old store's rows and the page's slots are, measured: they move
  // with the page's width and the length of the copy in each language.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const rows = rowRefs.current.filter((row): row is HTMLDivElement => row !== null);
      const slots = slotRefs.current.filter((slot): slot is HTMLDivElement => slot !== null);
      if (rows.length !== REVIEWS.length || slots.length !== REVIEWS.length) return;
      setLayout({
        rows: rows.map((row) => boxWithin(row, stage)),
        slots: slots.map((slot) => boxWithin(slot, stage)),
        rest: { x: stage.offsetWidth * REST.x, y: stage.offsetHeight * REST.y },
      });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const landed = beat.list === "landed";
  const held = beat.list === "lifted" || beat.list === "carried";

  /**
   * Where the list is on this beat, as an offset from its rows in the old
   * store, and how it gets there. The rows and the slots are spaced alike, so
   * one offset moves the whole list and lands every review in its slot.
   */
  function listMotion({ rows, slots }: Layout) {
    const carry = { x: slots[0].x - rows[0].x, y: slots[0].y - rows[0].y };
    switch (beat.list) {
      case "rest":
        return {
          animate: { x: 0, y: 0, scale: 1, opacity: 1 },
          // Back from "gone": appear in place rather than fly home.
          transition: { default: { duration: 0 }, opacity: { duration: DURATION.slow, ease: EASE_ENTRANCE } },
        };
      case "lifted":
        return { animate: { x: 0, y: -LIFT, scale: 1.02, opacity: 1 }, transition: POP };
      case "carried":
        return { animate: { x: carry.x, y: carry.y - LIFT, scale: 1.02, opacity: 1 }, transition: GLIDE };
      case "landed":
        return { animate: { x: carry.x, y: carry.y, scale: 1, opacity: 1 }, transition: POP };
      case "gone":
        return {
          animate: { x: carry.x, y: carry.y, scale: 1, opacity: 0 },
          transition: { duration: DURATION.slow, ease: EASE_STANDARD },
        };
    }
  }

  const cursorAt = layout
    ? beat.cursor === "rest"
      ? layout.rest
      : grip(around(beat.cursor === "list" ? layout.rows : layout.slots))
    : null;

  return (
    <div
      ref={stageRef}
      aria-hidden="true"
      data-review-import-story={still ? "still" : "playing"}
      className={cn(cardClass, "@container relative overflow-hidden")}
    >
      {/* Side by side when there is room; stacked, the old store above the new one,
          when there is not, so neither is squeezed. */}
      <div className="grid grid-cols-1 items-start gap-3 bg-secondary p-3 @md:grid-cols-2">
        {/* The store the reviews are leaving: somebody else's site, plain and editorial. */}
        <BrowserWindow
          favicon={<Globe className="size-3 shrink-0" strokeWidth={2} />}
          tab={t("product")}
          domain={OTHER_DOMAIN}
        >
          <div className="flex justify-center gap-2 border-b border-border px-3 py-3">
            <span className={cn(placeholderBarClass, "h-1 w-8")} />
            <span className={cn(placeholderBarClass, "h-1 w-8")} />
            <span className={cn(placeholderBarClass, "h-1 w-8")} />
          </div>
          {/* The same mug, as the old store sells it, with its reviews under it. */}
          <div className="flex flex-col p-3">
            <div className="flex gap-3">
              <ProductPhoto />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate font-display text-xs font-semibold uppercase tracking-wide text-foreground">
                  {t("product")}
                </span>
                <span className="font-inter text-xs text-muted-foreground">{formatPrice(PRODUCT_PRICE, "EUR", locale)}</span>
                <span className={cn(placeholderBarClass, "mt-1 w-full")} />
                <span className={cn(placeholderBarClass, "w-2/3")} />
                <span className="mt-1 w-fit max-w-full truncate whitespace-nowrap border border-foreground px-2 py-1 @md:px-3 font-inter text-xs font-medium uppercase tracking-wide text-foreground">
                  {t("addToCart")}
                </span>
              </div>
            </div>
            <span className="mb-3 mt-3 font-inter text-xs font-semibold text-foreground">{t("customerReviews")}</span>
            <ReviewRows refs={rowRefs} />
          </div>
        </BrowserWindow>

        {/* A product page on Square Share: photo, name, price, rating, buy, reviews. */}
        <BrowserWindow
          favicon={
            <svg
              viewBox={`0 0 ${BRAND_MARK.width} ${BRAND_MARK.height}`}
              className="size-3 shrink-0 text-foreground"
              fill="currentColor"
            >
              <path d={BRAND_MARK.path} />
            </svg>
          }
          tab={t("product")}
          domain={PAGE_DOMAIN}
        >
          <div className="flex flex-col p-3">
            <div className="flex gap-3">
              <ProductPhoto />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate font-inter text-xs font-semibold text-foreground">{t("product")}</span>
                <span className="font-inter text-xs text-muted-foreground">{formatPrice(PRODUCT_PRICE, "EUR", locale)}</span>
                <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                  <motion.span
                    className={landed ? "text-rating" : "text-muted-foreground"}
                    initial={false}
                    animate={{ opacity: landed ? 1 : 0.5 }}
                    transition={GLIDE}
                  >
                    <StarRating value={landed ? AVERAGE : 0} label="" />
                  </motion.span>
                  {landed && (
                    <motion.span
                      className="truncate font-inter text-xs text-muted-foreground"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: DURATION.slow, ease: EASE_ENTRANCE }}
                    >
                      {formatFixed(AVERAGE, 1, locale)}
                    </motion.span>
                  )}
                </span>
                <span className={cn(placeholderBarClass, "mt-1 w-full")} />
                <span className={cn(placeholderBarClass, "w-3/4")} />
                <span className="mt-1 w-fit max-w-full truncate whitespace-nowrap bg-primary px-2 py-1 @md:px-3 font-inter text-xs font-medium text-primary-foreground">
                  {tBuy("snippetText")}
                </span>
              </div>
            </div>
            <span className="mb-3 mt-3 font-inter text-xs font-semibold text-foreground">{tReviews("heading")}</span>
            {/* An empty list until the reviews land on it. */}
            <div className="relative">
              <motion.span
                className="absolute inset-0 rounded-md border border-dashed border-border"
                initial={false}
                animate={{ opacity: landed ? 0 : 1 }}
                transition={{ duration: DURATION.base, ease: EASE_STANDARD }}
              />
              <ReviewRows refs={slotRefs} />
            </div>
          </div>
        </BrowserWindow>
      </div>

      {/* The list, over both windows so it can travel between them: the
          reviews at their rows, moved as one, and the outline that shows the
          cursor holds all of them. */}
      {layout &&
        (() => {
          const { animate, transition } = listMotion(layout);
          const list = around(layout.rows);
          return (
            <motion.div
              className="absolute"
              style={{ left: list.x, top: list.y, width: list.width, height: list.height }}
              initial={false}
              animate={animate}
              transition={transition}
            >
              <motion.span
                className="absolute rounded-md border-3 border-dotted border-foreground"
                style={{ inset: -SELECTION_INSET }}
                initial={false}
                animate={{ opacity: held ? 1 : 0 }}
                transition={{ duration: DURATION.base, ease: EASE_STANDARD }}
              />
              {REVIEWS.map((review, index) => (
                <div
                  key={review.id}
                  className="absolute left-0"
                  style={{ top: layout.rows[index].y - list.y, width: list.width }}
                >
                  <ReviewRow
                    name={review.name}
                    photo={review.photo}
                    rating={review.rating}
                    quote={t(`reviews.${review.id}`)}
                    last={index === REVIEWS.length - 1}
                  />
                </div>
              ))}
            </motion.div>
          );
        })()}

      {cursorAt && !still && (
        <motion.span
          className="pointer-events-none absolute left-0 top-0"
          initial={false}
          animate={{ x: cursorAt.x - CURSOR_TIP, y: cursorAt.y - CURSOR_TIP, scale: beat.press ? PRESS_SCALE : 1 }}
          transition={GLIDE}
        >
          <MousePointer2 className="size-5 fill-foreground stroke-background drop-shadow-sm" strokeWidth={1.5} />
        </motion.span>
      )}
    </div>
  );
}
