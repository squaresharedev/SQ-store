"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Grab, Hand, Plus, Store } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { cn } from "@/lib/utils";
import { BrandMarkIcon } from "@/components/ui/BrandMarkIcon";
import { formatFixed } from "@/lib/format/intl";
import { formatPrice } from "@/lib/format";
import type { Locale } from "@/i18n/locales";
import { PRODUCTS_PATH } from "@/lib/products/paths";
import { DURATION, EASE_ENTRANCE, EASE_STANDARD, POP, PRESS_SCALE } from "@/components/ui/motion-tokens";
import { CURSOR_TIP, StoryPointerIcon, type StoryPoint } from "@/components/ui/story-motion";
import {
  cardClass,
  iconTileClass,
  onPhotoMutedTextClass,
  onPhotoTextClass,
  posterCardClass,
  posterMediaClass,
  posterPhotoClass,
  posterScrimFlatClass,
} from "@/components/ui/surface-styles";
import { BrowserWindow, PAGE_DOMAIN, type Box } from "./review-import-story-parts";
import { ProductImportAppScene } from "./ProductImportAppScene";
import {
  BOARD_SHADOW_BACKGROUND,
  GRAIN_BACKGROUND,
  LIFT_SCALE,
  LIFT_TILT,
  MATERIAL_COLOURS,
  SLOT_TARGET_CLASS,
  STORY_APP_WIDTH,
  STORY_ITEMS,
  storyColumns,
  storyLook,
  type ProductImportStoryLook,
  type StoryItem,
} from "./product-import-story-tokens";

/** How a photo fills a card: a full photo covers it; a cut-out with no background of its own sits inside it, on the card's paper. */
const FIT_CLASS = { cover: "object-cover", contain: "object-contain p-3" } as const;
/** Where on a product the cursor holds it, as a share of its box: low and to the right of centre, so the pointer never covers the photo's subject. */
const GRIP = { x: 0.62, y: 0.62 } as const;
/** Narrower than this (px: the stage's @md, 28rem) and every layout draws as `stack`. */
const NARROW_PX = 448;
/** The longest the cursor takes to cross the stage without a product in hand (s). */
const GLIDE_MAX = 0.8;
/** How much bigger than its place a landing poster starts (a share), so the set-down has something to settle from. */
const SETTLE_FROM = 1.04;
/** How far apart a restocked shelf's products pop back in (s). */
const RESTOCK_STAGGER = 0.05;
/** Literal classes, so Tailwind finds them: products to a row. */
const COLUMN_CLASSES: Record<number, string> = { 2: "grid-cols-2", 3: "grid-cols-3" };
/** How big the app is drawn before it has been measured (a share of its real size). */
const DEFAULT_SCALE = 0.4;

/** One beat of the story: how long it holds (ms), what the cursor is doing, and which product it is doing it to. */
type Phase = "rest" | "reach" | "grab" | "carry" | "drop" | "hold" | "clear";
type Beat = { ms: number; phase: Phase; item: number };

/** The beats' lengths (ms), before `pace`. The first trip is unhurried; the rest keep a quicker rhythm. */
const BEAT_MS = {
  rest: 700,
  hold: 2300,
  clear: 700,
  first: { reach: 800, grab: 300, carry: 1000, drop: 340 },
  next: { reach: 560, grab: 240, carry: 820, drop: 280 },
} as const;

/**
 * THE STORY, beat by beat: the cursor rests, then for each product reaches the
 * shelf, closes on it, drags it straight across and lets go in the catalogue;
 * a hold on the full catalogue, and the shelf restocks for the next take.
 */
function storyBeats(count: number, pace: number): Beat[] {
  const beats: Beat[] = [{ ms: BEAT_MS.rest, phase: "rest", item: -1 }];
  for (let item = 0; item < count; item++) {
    const ms = item === 0 ? BEAT_MS.first : BEAT_MS.next;
    beats.push(
      { ms: ms.reach, phase: "reach", item },
      { ms: ms.grab, phase: "grab", item },
      { ms: ms.carry, phase: "carry", item },
      { ms: ms.drop, phase: "drop", item },
    );
  }
  beats.push({ ms: BEAT_MS.hold, phase: "hold", item: count - 1 }, { ms: BEAT_MS.clear, phase: "clear", item: -1 });
  return beats.map((beat) => ({ ...beat, ms: beat.ms * pace }));
}

/** How many products are in the catalogue at a beat. */
function placedAt(beat: Beat, count: number): number {
  switch (beat.phase) {
    case "drop":
      return beat.item + 1;
    case "reach":
    case "grab":
    case "carry":
      return beat.item;
    case "hold":
      return count;
    default:
      return 0;
  }
}

/** Where the cursor holds a box: its grip point. */
const gripOf = (box: Box): StoryPoint => ({ x: box.x + GRIP.x * box.width, y: box.y + GRIP.y * box.height });

/** The measured stage: its size, each product's place on the shelf and in the catalogue, and where the cursor waits. */
type Layout = { width: number; height: number; items: Box[]; slots: Box[]; rest: StoryPoint };

/** A product as the catalogue lists it: the real poster, its photo and its name and price on the foot. */
function MiniPoster({ item }: { item: StoryItem }) {
  const t = useTranslations("Products.import.story.items");
  const locale = useLocale() as Locale;
  return (
    <div className={cn(posterCardClass, "size-full aspect-auto justify-end")}>
      <div className={posterMediaClass}>
        {/* Decorative, inside an aria-hidden stage: no alt text. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.photo} alt="" draggable={false} className={cn(posterPhotoClass, FIT_CLASS[item.fit])} />
        <div className={posterScrimFlatClass} />
      </div>
      <div className="min-w-0 p-2">
        <p className={cn(onPhotoTextClass, "truncate font-inter text-xs font-semibold")}>{t(item.id)}</p>
        <p className={cn(onPhotoMutedTextClass, "truncate font-inter text-xs tabular-nums")}>
          {formatPrice(item.price, "EUR", locale)}
        </p>
      </div>
    </div>
  );
}

/**
 * `node`'s box in `root`'s coordinates, from where each is DRAWN: right through
 * the transform the app is scaled down by (offsets, which ignore transforms,
 * would put the slots in the wrong place).
 */
function boxDrawn(node: HTMLElement, root: HTMLElement): Box {
  const box = node.getBoundingClientRect();
  const within = root.getBoundingClientRect();
  const k = root.offsetWidth / (within.width || 1);
  return { x: (box.left - within.left) * k, y: (box.top - within.top) * k, width: box.width * k, height: box.height * k };
}

/**
 * THE PRODUCT IMPORT'S MOTION GRAPHIC: a cursor reaches a real-looking shelf,
 * closes on a product, drags it straight across the stage and lets go of it in
 * the Square Share catalogue, where it lands as a product card and the count
 * goes up. What the import does, shown instead of told: a catalogue kept
 * somewhere else, moved here.
 *
 * `look` (product-import-story-tokens) picks the shelf and what it is made of,
 * how products stand on it, the pointer, and the frame the catalogue is drawn
 * in. Loops while the page is open; under reduced motion it is the landed
 * frame, still. Illustrative, so all of it is hidden from assistive tech.
 */
export function ProductImportStory({ look: given }: { look?: Partial<ProductImportStoryLook> }) {
  const look = storyLook(given);
  const t = useTranslations("Products.import.story");
  const tPage = useTranslations("Products.page");
  const locale = useLocale() as Locale;
  const still = useReducedMotion() ?? false;
  const [beats, setBeats] = useState(0);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [narrow, setNarrow] = useState(false);
  // The app is drawn at its real size and scaled to fit: how wide the room is, and how tall it came out.
  const [fitWidth, setFitWidth] = useState(0);
  const [appHeight, setAppHeight] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const shelfRef = useRef<HTMLDivElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<HTMLDivElement>(null);
  const designRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const slotRefs = useRef<(HTMLLIElement | null)[]>([]);

  const { count: total, frame, shelf, material, form, cursor, lift, landing: landingStyle } = look;
  const loose = form === "loose";
  const items = STORY_ITEMS.slice(0, total);
  const columns = storyColumns(total);
  const colours = MATERIAL_COLOURS[material];
  const drawn = narrow ? "stack" : look.layout;
  const designWidth = narrow ? STORY_APP_WIDTH.compact : STORY_APP_WIDTH.desktop;
  const scale = fitWidth ? fitWidth / designWidth : DEFAULT_SCALE;
  const story = storyBeats(total, look.pace);
  const beat: Beat = still ? { ms: 0, phase: "hold", item: total - 1 } : story[beats % story.length];
  const placed = placedAt(beat, total);
  const carrying = beat.phase === "carry";
  const held = beat.phase === "grab" || carrying;
  // The arrow's tip sits a little inside its box; the hand is held by its palm.
  const tipShift = cursor === "arrow" ? CURSOR_TIP : 0;

  useEffect(() => {
    if (still) return;
    const id = window.setTimeout(() => setBeats(beats + 1), beat.ms);
    return () => window.clearTimeout(id);
  }, [still, beats, beat.ms]);

  // The stage's width decides the layout (under NARROW_PX the shelf goes above and
  // the app turns to its phone layout); the app's room and height decide its scale.
  useEffect(() => {
    const stage = stageRef.current;
    const fit = fitRef.current;
    const design = designRef.current;
    if (!stage || !fit || !design || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      setNarrow(stage.offsetWidth < NARROW_PX);
      setFitWidth(fit.clientWidth);
      setAppHeight(design.offsetHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    observer.observe(fit);
    observer.observe(design);
    return () => observer.disconnect();
  }, [narrow, frame]);

  // Where each product sits on the shelf and in the catalogue, measured once the
  // app has its scale: the cursor and the held product work in the stage's own pixels.
  useEffect(() => {
    const stage = stageRef.current;
    const shelfPanel = shelfRef.current;
    const windowPanel = windowRef.current;
    if (!stage || !shelfPanel || !windowPanel || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const tiles = tileRefs.current.slice(0, total);
      const slots = slotRefs.current.slice(0, total);
      if (tiles.some((node) => !node) || slots.some((node) => !node)) return;
      const shelfBox = boxDrawn(shelfPanel, stage);
      const windowBox = boxDrawn(windowPanel, stage);
      const stacked = stage.offsetWidth < NARROW_PX || look.layout === "stack";
      setLayout({
        width: stage.offsetWidth,
        height: stage.offsetHeight,
        items: (tiles as HTMLSpanElement[]).map((node) => boxDrawn(node, stage)),
        slots: (slots as HTMLLIElement[]).map((node) => boxDrawn(node, stage)),
        // Out of the way: in the gap beside the two, or the one between them.
        rest: stacked
          ? { x: stage.offsetWidth - shelfBox.width / 8, y: shelfBox.y + shelfBox.height + (windowBox.y - shelfBox.y - shelfBox.height) / 2 }
          : { x: shelfBox.x + shelfBox.width + (windowBox.x - shelfBox.x - shelfBox.width) / 2, y: shelfBox.y + shelfBox.height },
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [total, drawn, frame, shelf, form, look.layout, scale, appHeight]);

  // The catalogue's count rolls up as each product lands, and back to nothing between takes.
  const counted = useMotionValue(still ? placed : 0);
  const countText = useTransform(counted, (value) => formatFixed(Math.round(value), 0, locale));
  useEffect(() => {
    const controls = animate(counted, placed, placed ? { duration: DURATION.slow, ease: EASE_STANDARD } : { duration: 0 });
    return () => controls.stop();
  }, [counted, placed]);

  const tileRef = (index: number) => (node: HTMLSpanElement | null) => {
    tileRefs.current[index] = node;
  };
  const slotRef = (index: number) => (node: HTMLLIElement | null) => {
    slotRefs.current[index] = node;
  };

  /**
   * A product standing in its place on the shelf: the product itself (cut out of
   * its photo, or its photo as a flat print), with no shadow under it. Gone at
   * once when the cursor lifts it; it pops back in turn when the shelf restocks.
   */
  const shelfCell = (item: StoryItem, index: number) => {
    const taken = index < placed || (index === beat.item && held);
    return (
      <span key={item.id} ref={tileRef(index)} className="relative block aspect-square">
        <motion.span
          className="absolute inset-0"
          initial={false}
          animate={{ opacity: taken ? 0 : 1, scale: taken ? 0.92 : 1 }}
          transition={taken ? { duration: 0 } : { delay: index * RESTOCK_STAGGER, duration: DURATION.slow, ease: EASE_ENTRANCE }}
        >
          {loose ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.cutout} alt="" draggable={false} className="absolute inset-0 size-full object-contain object-bottom" />
          ) : (
            <span className="absolute inset-0 overflow-hidden border border-black/10 bg-card shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.photo} alt="" draggable={false} className={cn("size-full", FIT_CLASS[item.fit])} />
            </span>
          )}
        </motion.span>
      </span>
    );
  };

  const cells = items.map(shelfCell);
  const rows = Array.from({ length: Math.ceil(total / columns) }, (_, row) => cells.slice(row * columns, (row + 1) * columns));
  const gridClass = cn("grid gap-3", COLUMN_CLASSES[columns]);

  const rack = shelf === "rack";
  const cabinet = shelf === "bookcase" || shelf === "cubbies";
  const grain = colours.grain ? GRAIN_BACKGROUND : undefined;
  const faceStyle: CSSProperties = {
    backgroundColor: colours.front,
    backgroundImage: grain,
    boxShadow: `inset 0 1px 0 rgba(255,255,255,0.25), 0 1px 0 ${colours.edge}`,
  };

  /** A board: its top surface (where products stand), its front edge, and the shade it throws below. */
  const board = (withBrackets = false, shaded = true) => (
    <div className="relative">
      {!rack && <span className="block h-2" style={{ backgroundColor: colours.top, boxShadow: `inset 0 1px 0 ${colours.edge}` }} />}
      <span className={cn("block", rack ? "h-1.5" : "h-3")} style={faceStyle} />
      {shaded && <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-full h-4" style={{ background: BOARD_SHADOW_BACKGROUND }} />}
      {withBrackets &&
        [0.14, 0.86].map((at) => (
          <span key={at} className="absolute top-full h-2.5 w-1.5" style={{ left: `${at * 100}%`, backgroundColor: colours.edge }} />
        ))}
    </div>
  );

  /** A row of products standing on a board. A product's foot sinks into the board's top surface. */
  const shelfRow = (row: ReactNode[], index: number) => (
    <div key={index} className="relative">
      {shelf === "cubbies" ? (
        <div className="relative z-10 -mb-1.5 flex pt-3">
          {row.map((cell, at) => (
            <div key={at} className="min-w-0 flex-1 px-2.5" style={at > 0 ? { borderLeft: `7px solid ${colours.front}` } : undefined}>
              {cell}
            </div>
          ))}
        </div>
      ) : (
        <div className={cn(gridClass, "relative z-10 px-3 pt-4", !rack && "-mb-1.5")}>{row}</div>
      )}
      {board(shelf === "floating", !cabinet || index < rows.length - 1)}
    </div>
  );

  const shelfUnit = (
    <div
      className={cn("relative flex flex-col gap-3", cabinet && "px-2.5 pb-0 shadow-md", rack && "px-1.5")}
      style={cabinet ? { backgroundColor: colours.back, boxShadow: "inset 0 12px 14px -10px rgba(0,0,0,0.3)" } : undefined}
    >
      {/* The uprights, either side. */}
      {(cabinet || rack) &&
        ["left-0", "right-0"].map((side) => (
          <span
            key={side}
            aria-hidden="true"
            className={cn("absolute inset-y-0", side, rack ? "w-1.5" : "w-2.5")}
            style={{ backgroundColor: colours.front, backgroundImage: grain, boxShadow: `inset 0 0 0 1px ${colours.edge}` }}
          />
        ))}
      {cabinet && <span className="-mx-2.5 block h-3" style={faceStyle} />}
      {rows.map(shelfRow)}
    </div>
  );

  const shelfPanel = (
    <div ref={shelfRef} className={cn("flex min-w-0 flex-col gap-2.5", drawn === "split" && "w-5/12 shrink-0")}>
      <span className="flex items-center gap-2">
        <span className={cn(iconTileClass, "size-7 bg-background ring-1 ring-border")}>
          <Store className="size-3.5" strokeWidth={2} />
        </span>
        <span className="truncate font-inter text-xs font-medium text-foreground">{t("shelf")}</span>
      </span>
      {shelfUnit}
    </div>
  );

  /** The products page's grid: its slots are what the cursor drops into. */
  const catalogueGrid = (
  <ul className={cn("grid gap-3", COLUMN_CLASSES[columns])}>
    {items.map((item, index) => {
      const filled = index < placed;
      const targeted = (held || beat.phase === "reach") && beat.item === index;
      const landing = beat.phase === "drop" && beat.item === index && landingStyle === "ring";
      return (
        <li key={item.id} ref={slotRef(index)} className="relative aspect-[4/5]">
          <span
            className={cn(
              "absolute inset-0 flex items-center justify-center border-2 border-dashed text-muted-foreground transition-colors duration-base ease-standard motion-reduce:transition-none",
              targeted ? SLOT_TARGET_CLASS : "border-border",
            )}
          >
            <Plus className="size-5" strokeWidth={2} />
          </span>
          <AnimatePresence initial={false}>
            {filled && (
              <motion.div
                key="poster"
                className="absolute inset-0"
                initial={{ scale: SETTLE_FROM }}
                animate={{ scale: 1 }}
                exit={{ opacity: 0, transition: { duration: DURATION.slow, ease: EASE_STANDARD } }}
                transition={POP}
              >
                <MiniPoster item={item} />
              </motion.div>
            )}
          </AnimatePresence>
          {landing && (
            <motion.span
              key={beats}
              className="pointer-events-none absolute -inset-px border-2 border-foreground"
              initial={{ opacity: 0.8, scale: 1 }}
              animate={{ opacity: 0, scale: 1.14 }}
              transition={{ duration: DURATION.slow * 2, ease: EASE_STANDARD }}
            />
          )}
        </li>
      );
    })}
  </ul>
  );

  const scaledApp = (
    <div ref={fitRef} className="relative overflow-hidden bg-background" style={{ height: appHeight ? appHeight * scale : undefined }}>
      <div className="absolute left-0 top-0 origin-top-left" style={{ width: designWidth, transform: `scale(${scale})` }}>
        <ProductImportAppScene compact={narrow} designRef={designRef} count={<motion.span>{countText}</motion.span>} grid={catalogueGrid} />
      </div>
    </div>
  );

  const windowPanel = (
    <div ref={windowRef} className={cn("min-w-0", drawn === "split" ? "flex-1" : "w-full")}>
      {frame === "browser" ? (
        <BrowserWindow
          tabs={[{ key: "catalogue", favicon: <BrandMarkIcon className="size-3 text-foreground" />, title: tPage("heading") }]}
          domain={`${PAGE_DOMAIN}${PRODUCTS_PATH}`}
        >
          {scaledApp}
        </BrowserWindow>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border shadow-sm">{scaledApp}</div>
      )}
    </div>
  );

  // The cursor goes straight to the product, closes on it, and drags it straight to its slot.
  const itemBox = layout && beat.item >= 0 ? layout.items[beat.item] : undefined;
  const slotBox = layout && beat.item >= 0 ? layout.slots[beat.item] : undefined;
  const tip: StoryPoint | null = !layout
    ? null
    : beat.phase === "reach" || beat.phase === "grab"
      ? itemBox
        ? gripOf(itemBox)
        : layout.rest
      : beat.phase === "carry" || beat.phase === "drop"
        ? slotBox
          ? gripOf(slotBox)
          : layout.rest
        : layout.rest;
  const seconds = beat.ms / 1000;
  const handClass = "absolute left-0 top-0 size-7 -translate-x-1/2 -translate-y-1/2 fill-background stroke-foreground drop-shadow-sm";

  return (
    <div
      ref={stageRef}
      aria-hidden="true"
      data-product-import-story={still ? "still" : "playing"}
      data-product-import-story-phase={beat.phase}
      data-product-import-story-layout={drawn}
      className={cn(cardClass, "@container pointer-events-none relative overflow-hidden bg-secondary")}
    >
      {drawn === "split" ? (
        <div className="relative flex items-center justify-between gap-6 p-4 @md:p-5">
          {shelfPanel}
          {windowPanel}
        </div>
      ) : (
        <div className="relative flex flex-col gap-8 p-3">
          {shelfPanel}
          {windowPanel}
        </div>
      )}

      {/* The cursor, with the product it holds: one element, so they cannot part on the way. */}
      {layout && tip && !still && (
        <motion.span
          className="pointer-events-none absolute left-0 top-0 z-20"
          initial={false}
          animate={{ x: tip.x - tipShift, y: tip.y - tipShift }}
          transition={{ duration: carrying ? seconds : Math.min(seconds, GLIDE_MAX), ease: EASE_STANDARD }}
        >
          {held && itemBox && slotBox && (
            <motion.span
              key={`held-${beat.item}`}
              className="absolute left-0 top-0 block"
              // It turns about the point the cursor holds it by.
              style={{ transformOrigin: `${GRIP.x * 100}% ${GRIP.y * 100}%` }}
              initial={{
                width: itemBox.width,
                height: itemBox.height,
                x: tipShift - GRIP.x * itemBox.width,
                y: tipShift - GRIP.y * itemBox.height,
                scale: 1,
                rotate: 0,
              }}
              animate={
                carrying
                  ? {
                      width: slotBox.width,
                      height: slotBox.height,
                      x: tipShift - GRIP.x * slotBox.width,
                      y: tipShift - GRIP.y * slotBox.height,
                      // Set down square at the end, so the poster that takes over is where it lands.
                      scale: [LIFT_SCALE, LIFT_SCALE, 1],
                      rotate: [LIFT_TILT[lift], LIFT_TILT[lift], 0],
                    }
                  : {
                      width: itemBox.width,
                      height: itemBox.height,
                      x: tipShift - GRIP.x * itemBox.width,
                      y: tipShift - GRIP.y * itemBox.height,
                      scale: LIFT_SCALE,
                      rotate: LIFT_TILT[lift],
                    }
              }
              transition={
                carrying
                  ? { duration: seconds, ease: EASE_STANDARD, scale: { duration: seconds, times: [0, 0.75, 1] }, rotate: { duration: seconds, times: [0, 0.75, 1] } }
                  : POP
              }
            >
              {/* Its photo, as a catalogue card; a loose product turns into it on the way, the cutout fading out as the card fades in. */}
              <motion.span
                className="absolute inset-0 overflow-hidden border border-black/10 bg-card shadow-lg"
                initial={false}
                animate={{ opacity: !loose || carrying ? 1 : 0 }}
                transition={{ duration: seconds * 0.5, delay: carrying ? seconds * 0.25 : 0 }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={STORY_ITEMS[beat.item].photo} alt="" draggable={false} className={cn("size-full", FIT_CLASS[STORY_ITEMS[beat.item].fit])} />
              </motion.span>
              {loose && (
                <motion.span
                  className="absolute inset-0"
                  initial={false}
                  animate={{ opacity: carrying ? 0 : 1 }}
                  transition={{ duration: seconds * 0.5, delay: carrying ? seconds * 0.25 : 0 }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={STORY_ITEMS[beat.item].cutout}
                    alt=""
                    draggable={false}
                    className="size-full object-contain object-bottom drop-shadow-lg"
                  />
                </motion.span>
              )}
            </motion.span>
          )}
          {cursor === "arrow" ? (
            <motion.span className="relative block" initial={false} animate={{ scale: held ? PRESS_SCALE : 1 }} transition={POP}>
              <StoryPointerIcon />
            </motion.span>
          ) : held ? (
            <Grab className={handClass} strokeWidth={1.75} />
          ) : (
            <Hand className={handClass} strokeWidth={1.75} />
          )}
        </motion.span>
      )}
    </div>
  );
}
