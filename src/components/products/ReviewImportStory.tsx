"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Globe, MousePointer2, Pause, Play } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { BRAND_MARK } from "@/lib/brand";
import { formatFixed } from "@/lib/format/intl";
import { formatPrice } from "@/lib/format";
import type { Locale } from "@/i18n/locales";
import { BrowserChrome } from "@/components/ui/BrowserChrome";
import { StarRating } from "@/components/product-page/StarRating";
import { iconButtonClass } from "@/components/ui/control-styles";
import { DURATION, EASE_ENTRANCE, EASE_STANDARD, POP, PRESS_SCALE } from "@/components/ui/motion-tokens";
import { cardClass, placeholderBarClass } from "@/components/ui/surface-styles";

/** The reviews being carried over. Names are people, not copy; the quotes are. */
const REVIEWS = [
  { id: "a", name: "Anna K.", rating: 5 },
  { id: "b", name: "Tomás R.", rating: 5 },
  { id: "c", name: "Mia L.", rating: 4 },
] as const;

/** Their average, as the product page shows it once they land. */
const AVERAGE = REVIEWS.reduce((sum, review) => sum + review.rating, 0) / REVIEWS.length;

/** The made-up product the reviews land on: a mug, priced in the store currency. */
const PRODUCT_PRICE = 24;

/** One review card's box, shared by the card and the slot it lands in. */
const REVIEW_CARD_SIZE = "h-10 w-full";

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
  { list: "rest", cursor: "rest", press: false, ms: 900 },
  { list: "rest", cursor: "list", press: false, ms: 850 },
  { list: "lifted", cursor: "list", press: true, ms: 320 },
  { list: "carried", cursor: "drop", press: true, ms: 1000 },
  { list: "landed", cursor: "drop", press: false, ms: 700 },
  { list: "landed", cursor: "rest", press: false, ms: 2400 },
  { list: "gone", cursor: "rest", press: false, ms: 400 },
];

/** The beat the picture rests on: everything landed, cursor out of the way. */
const LANDED_BEAT = 5;

/** How many times the story plays before it rests on the landed frame. */
const LOOPS = 2;

/** Travel across the stage: slower than a state change. */
const GLIDE = { duration: 0.7, ease: EASE_STANDARD };
/** How far the list rises when it is picked up (px). */
const LIFT = 3;
/** The selection outline's margin around the list it holds (px). */
const SELECTION_INSET = 4;
/** Where the cursor rests, as a fraction of the stage: low, between the windows. */
const REST = { x: 0.5, y: 0.9 };
/** The pointer's tip sits this far inside its own box (px). */
const CURSOR_TIP = 3;
/** Where on the list the cursor grabs it, as a fraction of the list. */
const AIM = { x: 0.78, y: 0.55 };

type Box = { x: number; y: number; width: number; height: number };
type Layout = { rows: Box[]; slots: Box[]; rest: { x: number; y: number } };

/** `node`'s box in `root`'s coordinates. Offsets, not bounding rects, so a
 *  transform on the way (the card lifting) never moves the measurement. */
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

/** A drawn browser window: the chrome, then the page. */
function Window({ chrome, children }: { chrome: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-md border border-border bg-background">
      <BrowserChrome>{chrome}</BrowserChrome>
      <div className="flex flex-1 flex-col p-3">{children}</div>
    </div>
  );
}

/** The product photo: a glazed mug on a studio backdrop, drawn. */
function MugPhoto() {
  return (
    <div className="flex size-16 shrink-0 items-center justify-center rounded-sm bg-secondary @md:size-20">
      <svg viewBox="0 0 64 64" className="size-4/5" fill="none">
        <ellipse cx="29" cy="54" rx="18" ry="3" className="fill-foreground/10" />
        <path d="M44 26h4a7 7 0 0 1 0 14h-4" className="stroke-foreground" strokeWidth="3" />
        <path d="M14 20h30v26a8 8 0 0 1-8 8H22a8 8 0 0 1-8-8z" className="fill-background stroke-foreground" strokeWidth="2" />
        <path d="M14 20h30v10H14z" className="fill-primary" />
        <path d="M24 8c-2 3 2 5 0 8M32 6c-2 3 2 5 0 8" className="stroke-muted-foreground" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}

/** One review as the old store lists it: who, how many stars, what they said. */
function ReviewCard({ name, rating, quote }: { name: string; rating: number; quote: string }) {
  return (
    <div className={cn(cardClass, REVIEW_CARD_SIZE, "flex items-center gap-2 bg-background px-2.5")}>
      <span className="hidden size-6 shrink-0 items-center justify-center rounded-full bg-secondary font-inter text-xs font-medium text-foreground @md:flex">
        {name.charAt(0)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-inter text-xs font-medium text-foreground">{name}</span>
          <StarRating value={rating} label="" />
        </span>
        <span className="truncate font-inter text-xs text-muted-foreground">{quote}</span>
      </span>
    </div>
  );
}

/**
 * THE MOTION GRAPHIC ON THE REVIEW IMPORT: what the page does, shown. A cursor
 * picks up the review list in the store the seller is leaving, all of it at
 * once, carries it to a product page on Square Share and lets go; the reviews
 * settle into the page's review list and its rating fills in.
 *
 * The old store is drawn generic (a globe, no brand): the importer reads
 * several review apps' exports. Plays `LOOPS` times and rests on the landed
 * frame, with play/pause; under reduced motion it starts on that frame.
 * Illustrative, so the picture is hidden from assistive tech; only the
 * play/pause control is announced. Same choreography as BuyButtonStory.
 */
export function ReviewImportStory() {
  const t = useTranslations("Products.reviewImport.story");
  const tDemo = useTranslations("Products.buyButton");
  const tReviews = useTranslations("ProductPage.reviews");
  const locale = useLocale() as Locale;
  const prefersStill = useReducedMotion();
  const [playing, setPlaying] = useState(!prefersStill);
  // Beats played; the beat on screen is its remainder. Starts landed when it
  // will not play by itself, so the still picture is the finished one.
  const [beats, setBeats] = useState(prefersStill ? LANDED_BEAT : 0);
  const [layout, setLayout] = useState<Layout | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const slotRefs = useRef<(HTMLDivElement | null)[]>([]);

  const beat = STORY[beats % STORY.length];

  useEffect(() => {
    if (!playing) return;
    const id = window.setTimeout(() => {
      const played = beats + 1;
      setBeats(played);
      // Rest on the landed frame of every LOOPS-th take.
      const take = Math.floor(played / STORY.length);
      if (played % STORY.length === LANDED_BEAT && take % LOOPS === LOOPS - 1) setPlaying(false);
    }, beat.ms);
    return () => window.clearTimeout(id);
  }, [playing, beats, beat.ms]);

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

  const held = beat.list === "lifted" || beat.list === "carried";
  const cursorAt = layout
    ? beat.cursor === "rest"
      ? layout.rest
      : grip(around(beat.cursor === "list" ? layout.rows : layout.slots))
    : null;

  return (
    <div className="relative" data-review-import-story={playing ? "playing" : "still"}>
      <div ref={stageRef} aria-hidden="true" className={cn(cardClass, "@container relative overflow-hidden")}>
        <div className="grid grid-cols-2 gap-3 bg-secondary p-3">
          {/* The store the reviews are leaving, with its review list. */}
          <Window
            chrome={
              <>
                <Globe className="size-3 shrink-0" strokeWidth={2} />
                <span className={cn(placeholderBarClass, "w-16")} />
              </>
            }
          >
            <span className={cn(placeholderBarClass, "w-1/2")} />
            <span className={cn(placeholderBarClass, "mt-2 w-1/3")} />
            {/* Where the reviews sit in the old store, spaced like the page's slots. */}
            <div className="mt-auto flex flex-col gap-1.5">
              {REVIEWS.map((review, index) => (
                <div
                  key={review.id}
                  ref={(node) => {
                    rowRefs.current[index] = node;
                  }}
                  className={REVIEW_CARD_SIZE}
                />
              ))}
            </div>
          </Window>

          {/* A product page on Square Share: photo, name, price, rating, buy. */}
          <Window
            chrome={
              <>
                <svg
                  viewBox={`0 0 ${BRAND_MARK.width} ${BRAND_MARK.height}`}
                  className="size-3 shrink-0 text-foreground"
                  fill="currentColor"
                >
                  <path d={BRAND_MARK.path} />
                </svg>
                <span className={cn(placeholderBarClass, "w-16")} />
              </>
            }
          >
            <div className="flex gap-3">
              <MugPhoto />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate font-inter text-xs font-semibold text-foreground">{t("product")}</span>
                <span className="font-inter text-xs text-muted-foreground">
                  {formatPrice(PRODUCT_PRICE, "EUR", locale)}
                </span>
                <span className="flex min-w-0 items-center gap-1.5 text-foreground">
                  <motion.span initial={false} animate={{ opacity: landed ? 1 : 0.4 }} transition={GLIDE}>
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
                <span className="mt-1 w-fit whitespace-nowrap bg-primary px-3 py-1 font-inter text-xs font-medium text-primary-foreground">
                  {tDemo("snippetText")}
                </span>
              </div>
            </div>
            <span className="mt-3 font-inter text-xs font-semibold text-foreground">{tReviews("heading")}</span>
            <div className="mt-1.5 flex flex-col gap-1.5">
              {REVIEWS.map((review, index) => (
                <div
                  key={review.id}
                  ref={(node) => {
                    slotRefs.current[index] = node;
                  }}
                  className={cn(REVIEW_CARD_SIZE, "rounded-md border border-dashed border-border")}
                />
              ))}
            </div>
          </Window>
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
                  className="absolute rounded-md border border-dashed border-foreground/40"
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
                    <ReviewCard name={review.name} rating={review.rating} quote={t(`reviews.${review.id}`)} />
                  </div>
                ))}
              </motion.div>
            );
          })()}

        {cursorAt && (
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

      <button
        type="button"
        onClick={() => setPlaying(!playing)}
        aria-label={tDemo(playing ? "demo.pause" : "demo.play")}
        className={cn(iconButtonClass, "absolute bottom-1.5 right-1.5 size-6 border-0 bg-transparent")}
      >
        {playing ? (
          <Pause className="size-3.5" strokeWidth={2} aria-hidden="true" />
        ) : (
          <Play className="size-3.5" strokeWidth={2} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
