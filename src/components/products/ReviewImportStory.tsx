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

/** Where the card sits in the pile before it is picked up: a loose stack. */
const PILE_OFFSETS = [
  { x: 0, y: 0, rotate: 0 },
  { x: 5, y: -6, rotate: -4 },
  { x: -4, y: -11, rotate: 3 },
] as const;

/** Where the pile is: in the other store, lifted, carried, landed, or gone for the next take. */
type Pile = "rest" | "lifted" | "carried" | "landed" | "gone";

/** Where the cursor is heading. */
type CursorTarget = "rest" | "pile" | "drop";

/**
 * THE STORY, beat by beat. The cursor goes to the pile of reviews in the old
 * store, picks it up, carries it across to the product page, lets go, and the
 * reviews deal into the page's review list while its rating fills in. The
 * last beat clears them for the next take.
 */
const STORY: readonly { pile: Pile; cursor: CursorTarget; press: boolean; ms: number }[] = [
  { pile: "rest", cursor: "rest", press: false, ms: 900 },
  { pile: "rest", cursor: "pile", press: false, ms: 850 },
  { pile: "lifted", cursor: "pile", press: true, ms: 280 },
  { pile: "carried", cursor: "drop", press: true, ms: 1000 },
  { pile: "landed", cursor: "drop", press: false, ms: 700 },
  { pile: "landed", cursor: "rest", press: false, ms: 2400 },
  { pile: "gone", cursor: "rest", press: false, ms: 400 },
];

/** The beat the picture rests on: everything landed, cursor out of the way. */
const LANDED_BEAT = 5;

/** How many times the story plays before it rests on the landed frame. */
const LOOPS = 2;

/** Travel across the stage: slower than a state change. */
const GLIDE = { duration: 0.7, ease: EASE_STANDARD };
/** Each card's beat after the one before it as they deal into the list (s). */
const DEAL_STAGGER = 0.08;
/** Where the cursor rests, as a fraction of the stage: low, between the windows. */
const REST = { x: 0.5, y: 0.9 };
/** The pointer's tip sits this far inside its own box (px). */
const CURSOR_TIP = 3;
/** Where on the top card the cursor grabs, as a fraction of the card. */
const AIM = { x: 0.72, y: 0.7 };

type Box = { x: number; y: number; width: number; height: number };
type Layout = { pile: Box; slots: Box[]; rest: { x: number; y: number } };

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

/** The point the cursor holds a card by. */
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
 * picks up a pile of reviews in the store the seller is leaving, carries them
 * to a product page on Square Share, and lets go; the reviews deal into the
 * page's review list and its rating fills in.
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
  const pileRef = useRef<HTMLDivElement>(null);
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

  // Where the pile and the three slots are, measured: they move with the
  // page's width and the length of the copy in each language.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const pile = pileRef.current;
      const slots = slotRefs.current.filter((slot): slot is HTMLDivElement => slot !== null);
      if (!pile || slots.length !== REVIEWS.length) return;
      setLayout({
        pile: boxWithin(pile, stage),
        slots: slots.map((slot) => boxWithin(slot, stage)),
        rest: { x: stage.offsetWidth * REST.x, y: stage.offsetHeight * REST.y },
      });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const landed = beat.pile === "landed";

  /** Where card `index` is on this beat, and how it gets there. */
  function cardMotion(index: number, { pile, slots }: Layout) {
    const slot = slots[index];
    // The pile is centred in the old store's window, at the slots' width.
    const home = { x: pile.x + (pile.width - slot.width) / 2, y: pile.y };
    const carry = { x: slots[0].x - home.x, y: slots[0].y - home.y };
    const offset = PILE_OFFSETS[index];
    switch (beat.pile) {
      case "rest":
        return {
          animate: { x: home.x + offset.x, y: home.y + offset.y, rotate: offset.rotate, scale: 1, opacity: 1 },
          // Back from "gone": appear in place rather than fly home.
          transition: { default: { duration: 0 }, opacity: { duration: DURATION.slow, ease: EASE_ENTRANCE } },
        };
      case "lifted":
        return {
          animate: { x: home.x + offset.x, y: home.y + offset.y - 3, rotate: offset.rotate, scale: 1.04, opacity: 1 },
          transition: POP,
        };
      case "carried":
        return {
          animate: {
            x: home.x + offset.x + carry.x,
            y: home.y + offset.y + carry.y - 3,
            rotate: offset.rotate,
            scale: 1.04,
            opacity: 1,
          },
          transition: GLIDE,
        };
      case "landed":
        return {
          animate: { x: slot.x, y: slot.y, rotate: 0, scale: 1, opacity: 1 },
          transition: { ...POP, delay: index * DEAL_STAGGER },
        };
      case "gone":
        return {
          animate: { x: slot.x, y: slot.y, rotate: 0, scale: 1, opacity: 0 },
          transition: { duration: DURATION.slow, ease: EASE_STANDARD },
        };
    }
  }

  const cursorAt = layout
    ? beat.cursor === "rest"
      ? layout.rest
      : beat.cursor === "pile"
        ? grip({ ...layout.pile, x: layout.pile.x + (layout.pile.width - layout.slots[0].width) / 2, width: layout.slots[0].width })
        : grip(layout.slots[0])
    : null;

  return (
    <div className="relative" data-review-import-story={playing ? "playing" : "still"}>
      <div ref={stageRef} aria-hidden="true" className={cn(cardClass, "@container relative overflow-hidden")}>
        <div className="grid grid-cols-2 gap-3 bg-secondary p-3">
          {/* The store the reviews are leaving: a pile of them, nothing else. */}
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
            <div className="flex flex-1 items-center">
              <div ref={pileRef} className={REVIEW_CARD_SIZE} />
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

        {/* The cards, over both windows so they can travel between them. The
            first is the pile's top card, so it is drawn last. */}
        {layout &&
          REVIEWS.map((review, index) => ({ review, index }))
            .reverse()
            .map(({ review, index }) => {
              const { animate, transition } = cardMotion(index, layout);
              return (
                <motion.div
                  key={review.id}
                  className="absolute left-0 top-0"
                  style={{ width: layout.slots[index].width }}
                  initial={false}
                  animate={animate}
                  transition={transition}
                >
                  <ReviewCard name={review.name} rating={review.rating} quote={t(`reviews.${review.id}`)} />
                </motion.div>
              );
            })}

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
