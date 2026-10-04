"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowRight, CreditCard, Globe, Lock, MousePointer2, Pause, Play } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { BRAND_MARK } from "@/lib/brand";
import { formatPrice } from "@/lib/format";
import { BrowserChrome } from "@/components/ui/BrowserChrome";
import { ProductThumb } from "@/components/ui/ProductThumb";
import { iconButtonClass, infoTextClass } from "@/components/ui/control-styles";
import { DURATION, EASE_ENTRANCE, EASE_STANDARD, POP, PRESS_SCALE } from "@/components/ui/motion-tokens";
import { cardClass, lockBadgeClass, placeholderBarClass } from "@/components/ui/surface-styles";
import type { Product } from "@/types/product";

/** The three screens of the story, in the order a buyer meets them. */
const SCENES = ["site", "page", "checkout"] as const;
type Scene = (typeof SCENES)[number];

/** Where the cursor can be heading: out of the way, or onto one of the two buttons. */
type CursorTarget = "rest" | "site" | "page";

/**
 * THE STORY, beat by beat: which screen is up, where the cursor is heading,
 * whether it is pressing, and how long the beat holds (ms). The cursor waits,
 * goes to the seller's own button and clicks; the product page opens; it goes
 * to that page's button and clicks; the checkout opens and is left on screen
 * long enough to be read.
 */
const STORY: readonly { scene: Scene; cursor: CursorTarget; press: boolean; ms: number }[] = [
  { scene: "site", cursor: "rest", press: false, ms: 900 },
  { scene: "site", cursor: "site", press: false, ms: 850 },
  { scene: "site", cursor: "site", press: true, ms: 280 },
  { scene: "page", cursor: "site", press: false, ms: 1100 },
  { scene: "page", cursor: "page", press: false, ms: 850 },
  { scene: "page", cursor: "page", press: true, ms: 280 },
  { scene: "checkout", cursor: "rest", press: false, ms: 2400 },
];

/** How many times the story plays before it rests on its first frame. It sits
 *  beside the thing the seller came to copy, so it must not move forever. */
const LOOPS = 2;

/** The cursor crossing the stage: slower than a state change, it is travel. */
const GLIDE = { duration: 0.7, ease: EASE_STANDARD };
/** A screen opening over the one before it. */
const OPEN = { duration: DURATION.slow, ease: EASE_ENTRANCE };
/** How far below its place a screen waits before it opens (px). */
const OPEN_RISE = 10;
/** The address the seller's own site shows: a stand-in, since the story is
 *  about whatever site they put the button on. A domain, not copy. */
const SITE_DOMAIN = "yourdomain.com";
/** The ring a click leaves behind. */
const RIPPLE = { duration: 0.45, ease: EASE_STANDARD };
/** Where the cursor rests, as a fraction of the stage: low and near the
 *  middle, clear of both buttons. */
const REST = { x: 0.55, y: 0.86 };
/** The pointer's tip sits this far inside its own box (px), so the TIP lands on the target. */
const CURSOR_TIP = 3;
/** Where on a button the cursor clicks, as a fraction of the button: right of
 *  and below its centre, so the pointer never covers the label. */
const AIM = { x: 0.78, y: 0.8 };

type Point = { x: number; y: number };

/** The point on `node` the cursor clicks, in `root`'s coordinates. Offsets, not
 *  bounding rects: the dialog arrives with a transform, and a screen waits
 *  below its place. */
function aimWithin(node: HTMLElement, root: HTMLElement): Point {
  let x = node.offsetWidth * AIM.x;
  let y = node.offsetHeight * AIM.y;
  for (let el: HTMLElement | null = node; el && el !== root; el = el.offsetParent as HTMLElement | null) {
    x += el.offsetLeft;
    y += el.offsetTop;
  }
  return { x, y };
}

/** The beat the cursor last pressed on, or null before its first click. It keys
 *  the click's ring, so each click draws a fresh one that plays out in full
 *  however short the press itself is. */
function lastClick(beats: number): number | null {
  for (let played = beats; played >= 0; played--) {
    if (STORY[played % STORY.length].press) return played;
  }
  return null;
}

/**
 * One screen of the story, stacked on the others (later screens on top). Only
 * the current one shows, and one still to come waits a little below its place.
 *
 * Never a crossfade, which shows two half-drawn pages at once. Going forward,
 * the new screen opens OVER the old one, which stays solid until it is covered;
 * when the story starts again, the first screen is simply there underneath and
 * the last one closes off it.
 */
function Screen({
  index,
  current,
  previous,
  children,
}: {
  index: number;
  current: number;
  /** The screen that was up one beat ago. */
  previous: number;
  children: ReactNode;
}) {
  const shown = index === current;
  const forward = current >= previous;
  const covered = { duration: 0, delay: OPEN.duration };
  return (
    <motion.div
      className="absolute inset-0 flex items-center gap-3 bg-background p-3"
      initial={false}
      animate={{ opacity: shown ? 1 : 0, y: index > current ? OPEN_RISE : 0 }}
      transition={shown ? (forward ? OPEN : { duration: 0 }) : forward ? covered : OPEN}
    >
      {children}
    </motion.div>
  );
}

/** A button in the picture that sinks while the cursor is pressing it. */
function PressButton({
  pressed,
  buttonRef,
  className,
  children,
}: {
  pressed: boolean;
  buttonRef: RefObject<HTMLSpanElement | null>;
  className: string;
  children: ReactNode;
}) {
  return (
    <motion.span
      ref={buttonRef}
      className={cn("inline-flex items-center justify-center font-inter text-xs font-medium", className)}
      initial={false}
      animate={{ scale: pressed ? PRESS_SCALE : 1 }}
      transition={POP}
    >
      {children}
    </motion.span>
  );
}

/**
 * THE MOTION GRAPHIC THAT REPLACES A PARAGRAPH: what a buy button does, shown
 * rather than told. A cursor clicks the seller's own button on their own site,
 * this product's page opens, the cursor clicks Buy there, and the checkout
 * opens. The product in it is the seller's real one (its photo, name and
 * price), so the picture is about THEIR button, not buttons in general.
 *
 * It plays `LOOPS` times and then rests on its first frame, with a play/pause
 * control for anyone who wants it again or wants it still. Under reduced motion
 * it never starts by itself. While the product has no page to land on it does
 * not play at all: the picture dims behind a lock, the signal the embed hero
 * gives.
 *
 * Illustrative, so the picture and the steps under it are hidden from
 * assistive tech (the dialog says the same in one screen-reader sentence);
 * only the play/pause control is announced.
 */
export function BuyButtonStory({
  product,
  live,
  pageHost,
}: {
  product: Pick<Product, "title" | "imageUrl" | "price" | "currency">;
  /** The product has a page to land on. False dims the picture behind a lock. */
  live: boolean;
  /** The host the button leads to (the real link's), for the address bar once
   *  the page has opened. Without one the bar shows a placeholder line. */
  pageHost?: string;
}) {
  const t = useTranslations("Products.buyButton");
  const locale = useLocale();
  const prefersStill = useReducedMotion();
  const [playing, setPlaying] = useState(!prefersStill);
  // Beats played since the dialog opened; the beat on screen is its remainder.
  // It only ever counts up, so a pause holds the frame, a finished story rests
  // on the first frame of the next loop, and the beat before is always known.
  const [beats, setBeats] = useState(0);
  const [targets, setTargets] = useState<Record<CursorTarget, Point> | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const siteButtonRef = useRef<HTMLSpanElement>(null);
  const pageButtonRef = useRef<HTMLSpanElement>(null);

  const running = playing && live;
  const beat = STORY[beats % STORY.length];
  const current = SCENES.indexOf(beat.scene);
  const previous = beats > 0 ? SCENES.indexOf(STORY[(beats - 1) % STORY.length].scene) : current;

  useEffect(() => {
    if (!running) return;
    const id = window.setTimeout(() => {
      const played = beats + 1;
      setBeats(played);
      if (played % (STORY.length * LOOPS) === 0) setPlaying(false);
    }, beat.ms);
    return () => window.clearTimeout(id);
  }, [running, beats, beat.ms]);

  // Where the two buttons are, measured: their place moves with the dialog's
  // width and the length of the label in each language.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const site = siteButtonRef.current;
      const page = pageButtonRef.current;
      if (!site || !page) return;
      setTargets({
        rest: { x: stage.offsetWidth * REST.x, y: stage.offsetHeight * REST.y },
        site: aimWithin(site, stage),
        page: aimWithin(page, stage),
      });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const aim = targets?.[beat.cursor];
  const click = lastClick(beats);
  const price = formatPrice(product.price, product.currency, locale);
  const buyLabel = t("snippetText");
  const captions: Record<Scene, string> = {
    site: t("flow.button"),
    page: product.title,
    checkout: t("flow.checkout"),
  };

  return (
    // Locked, it is a picture of something switched off: `inert`, as a disabled
    // control is, so its dimmed words are not read as live text (by a person
    // or by a contrast check). The reason and its fix sit under it at full ink.
    <div
      data-buy-button-flow={live ? "live" : "locked"}
      data-buy-button-scene={beat.scene}
      inert={!live}
      className="space-y-2"
    >
      <div className="relative">
        <div
          ref={stageRef}
          aria-hidden="true"
          className={cn(cardClass, "relative overflow-hidden", !live && "opacity-50 grayscale")}
        >
          <BrowserChrome className={live ? "pr-10" : undefined}>
            {/* Whose page this is: the seller's own site, then ours. */}
            {beat.scene === "site" ? (
              <Globe className="size-3 shrink-0" strokeWidth={2} />
            ) : (
              <svg
                viewBox={`0 0 ${BRAND_MARK.width} ${BRAND_MARK.height}`}
                className="size-3 shrink-0 text-foreground"
                fill="currentColor"
              >
                <path d={BRAND_MARK.path} />
              </svg>
            )}
            {/* Real text in the address bar, so it reads as a website. */}
            {beat.scene === "site" ? (
              <span className="truncate text-foreground">{SITE_DOMAIN}</span>
            ) : pageHost ? (
              <span className="truncate text-foreground">{pageHost}</span>
            ) : (
              <span className={cn(placeholderBarClass, "w-24")} />
            )}
          </BrowserChrome>

          <div className="relative h-32">
            {/* 1. The seller's own site, in its own (rounder) style, with THEIR button. */}
            <Screen index={0} current={current} previous={previous}>
              <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
                <span className="w-full truncate text-xs font-semibold text-foreground">{product.title}</span>
                <span className="font-inter text-xs text-muted-foreground">{t("demo.siteLine")}</span>
                <span className={cn(placeholderBarClass, "w-4/5")} />
                <PressButton
                  buttonRef={siteButtonRef}
                  pressed={beat.press && beat.cursor === "site"}
                  className="mt-1 rounded-full bg-foreground px-3 py-1.5 text-background"
                >
                  {buyLabel}
                </PressButton>
              </div>
              <ProductThumb src={product.imageUrl} className="size-24 rounded-md" />
            </Screen>

            {/* 2. This product's page, as Square Share draws it. */}
            <Screen index={1} current={current} previous={previous}>
              <ProductThumb src={product.imageUrl} className="size-26 rounded-none" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <span className="truncate text-xs font-semibold text-foreground">{product.title}</span>
                <span className="font-inter text-xs text-muted-foreground">{price}</span>
                <span className={cn(placeholderBarClass, "w-3/4")} />
                <PressButton
                  buttonRef={pageButtonRef}
                  pressed={beat.press && beat.cursor === "page"}
                  className="mt-1 w-full bg-primary px-3 py-1.5 text-primary-foreground"
                >
                  {buyLabel}
                </PressButton>
              </div>
            </Screen>

            {/* 3. The checkout: what is being bought, and where to pay. */}
            <Screen index={2} current={current} previous={previous}>
              <div className="flex w-2/5 min-w-0 flex-col gap-2">
                <div className="flex items-center gap-2">
                  <ProductThumb src={product.imageUrl} className="size-9 rounded-none" />
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">{product.title}</span>
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
                  <span className="font-inter text-xs text-muted-foreground">{t("demo.total")}</span>
                  <span className="font-inter text-xs font-medium text-foreground">{price}</span>
                </div>
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="flex h-6 items-center border border-border px-2 font-inter text-xs text-muted-foreground">
                  <span className="truncate">{t("demo.email")}</span>
                </span>
                <span className="flex h-6 items-center gap-1.5 border border-border px-2 font-inter text-xs text-muted-foreground">
                  <CreditCard className="size-3 shrink-0" strokeWidth={2} />
                  <span className="truncate">{t("demo.card")}</span>
                </span>
                <span className="flex h-7 items-center justify-center gap-1.5 bg-primary px-2 font-inter text-xs font-medium text-primary-foreground">
                  <Lock className="size-3 shrink-0" strokeWidth={2} />
                  <span className="truncate">{t("demo.pay", { price })}</span>
                </span>
              </div>
            </Screen>
          </div>

          {/* The cursor, and the ring its click leaves. Drawn once it knows where the buttons are. */}
          {live && aim && (
            <motion.span
              className="pointer-events-none absolute left-0 top-0"
              initial={false}
              animate={{ x: aim.x - CURSOR_TIP, y: aim.y - CURSOR_TIP }}
              transition={GLIDE}
            >
              {click !== null && (
                <motion.span
                  key={click}
                  className="absolute -left-2 -top-2 size-6 rounded-full border border-foreground"
                  initial={{ scale: 0.3, opacity: 0.6 }}
                  animate={{ scale: 1.5, opacity: 0 }}
                  transition={RIPPLE}
                />
              )}
              <MousePointer2 className="relative size-5 fill-foreground stroke-background drop-shadow-sm" strokeWidth={1.5} />
            </motion.span>
          )}
        </div>

        {live ? (
          <button
            type="button"
            onClick={() => setPlaying(!playing)}
            aria-label={t(playing ? "demo.pause" : "demo.play")}
            data-buy-button-demo={playing ? "playing" : "still"}
            className={cn(iconButtonClass, "absolute right-2 top-1.5 size-6 border-0 bg-transparent")}
          >
            {playing ? (
              <Pause className="size-3.5" strokeWidth={2} aria-hidden="true" />
            ) : (
              <Play className="size-3.5" strokeWidth={2} aria-hidden="true" />
            )}
          </button>
        ) : (
          <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
            <span className={lockBadgeClass}>
              <Lock className="size-4" strokeWidth={2} />
            </span>
          </span>
        )}
      </div>

      {/* The same story as three words, the current one in ink. Ink only: a
          heavier weight would change the word's width and twitch the row. */}
      <div aria-hidden="true" className={cn(infoTextClass, "flex items-center justify-center gap-2")}>
        {SCENES.map((scene, index) => (
          <span key={scene} className={cn("flex min-w-0 items-center gap-2", scene !== "page" && "shrink-0")}>
            {index > 0 &&
              (index === 1 && !live ? (
                <Lock className="size-3.5 shrink-0" strokeWidth={2} />
              ) : (
                <ArrowRight className={cn("size-3.5 shrink-0", !live && "opacity-40")} strokeWidth={2} />
              ))}
            <span
              className={cn(
                "truncate transition-colors duration-base ease-standard motion-reduce:transition-none",
                live && index === current && "text-foreground",
                !live && index > 0 && "opacity-40",
              )}
            >
              {captions[scene]}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
