"use client";

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Lock, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * What the review import's motion graphic (ReviewImportBeams) is drawn from:
 * the reviewers, the mug the reviews land on, a drawn browser window, and how
 * a piece of it is measured.
 */

/** The reviews being carried over. Names and photos are people, not copy; the quotes are (Products.reviewImport.story.reviews). */
export const STORY_REVIEWS = [
  { id: "a", name: "Rafael M.", rating: 5, photo: "/review-import/reviewer-1.webp" },
  { id: "b", name: "Tomás R.", rating: 5, photo: "/review-import/reviewer-2.webp" },
  { id: "c", name: "Jonas B.", rating: 4, photo: "/review-import/reviewer-3.webp" },
  { id: "d", name: "Liam O.", rating: 5, photo: "/review-import/reviewer-4.webp" },
] as const;

export type StoryReview = (typeof STORY_REVIEWS)[number];

/** The made-up product the reviews land on: a mug, priced in the store currency. */
export const PRODUCT_PRICE = 24;

/** Where the product page lives. A domain, not copy. */
export const PAGE_DOMAIN = "squareshare.eu";

/** One review row's box. */
export const REVIEW_ROW_SIZE = "h-12 w-full";

export type Point = { x: number; y: number };
export type Box = Point & { width: number; height: number };

/** `node`'s box in `root`'s coordinates. Offsets, not bounding rects, so a
 *  transform on the way (a platform's kick as it sends) never moves the measurement. */
export function boxWithin(node: HTMLElement, root: HTMLElement): Box {
  let x = 0;
  let y = 0;
  for (let el: HTMLElement | null = node; el && el !== root; el = el.offsetParent as HTMLElement | null) {
    x += el.offsetLeft;
    y += el.offsetTop;
  }
  return { x, y, width: node.offsetWidth, height: node.offsetHeight };
}

/** The three window controls of a drawn browser, in their own colours. */
const WINDOW_DOTS = ["bg-window-close", "bg-window-minimize", "bg-window-zoom"] as const;

/** More tabs than this, and the ones not showing are drawn as their icon alone. */
const PINNED_TABS_PAST = 2;

/** A drawn browser tab: its favicon and title. */
export type Tab = { key: string; favicon: ReactNode; title: string };

/**
 * A drawn browser window, close enough to a real one to tell two sites apart:
 * window controls, a tab per site with its icon and title (`active` the one
 * showing), and, given a `domain`, back, forward, reload and the padlocked address.
 * With more than two tabs the ones not showing are their icon alone, as a
 * pinned tab is, rather than names cut to a letter or two.
 */
export function BrowserWindow({
  tabs,
  active = 0,
  domain,
  tabRef,
  className,
  children,
}: {
  tabs: Tab[];
  active?: number;
  domain?: string;
  /** Each tab's element, for a cursor to click. */
  tabRef?: (index: number, node: HTMLElement | null) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm", className)}>
      <div className="flex items-end gap-2 bg-secondary px-2 pt-1.5">
        <div className="flex gap-1 pb-2">
          {WINDOW_DOTS.map((dot) => (
            <span key={dot} className={cn("size-2 rounded-full", dot)} />
          ))}
        </div>
        <div className="flex min-w-0 flex-1 items-end gap-0.5">
          {tabs.map((tab, index) => {
            const iconOnly = tabs.length > PINNED_TABS_PAST && index !== active;
            return (
              <span
                key={tab.key}
                ref={tabRef ? (node) => tabRef(index, node) : undefined}
                className={cn(
                  "flex items-center gap-1.5 rounded-t-md px-2 py-1 font-inter text-xs",
                  // With several tabs the open one keeps its name (up to half the
                  // strip) and the others share what is left.
                  tabs.length === 1 || iconOnly ? "min-w-0 max-w-full" : index === active ? "max-w-1/2 shrink-0" : "min-w-0 flex-1",
                  index === active ? "bg-background text-foreground" : "text-muted-foreground",
                )}
              >
                {tab.favicon}
                {!iconOnly && <span className="truncate">{tab.title}</span>}
              </span>
            );
          })}
        </div>
      </div>
      {domain !== undefined && (
        <div className="flex items-center gap-1 border-b border-border px-2 py-1 text-muted-foreground">
          <ChevronLeft className="size-3 shrink-0" strokeWidth={2} />
          <ChevronRight className="size-3 shrink-0 opacity-40" strokeWidth={2} />
          <RotateCw className="size-3 shrink-0" strokeWidth={2} />
          <span className="ml-1 flex min-w-0 flex-1 items-center gap-1 rounded-full bg-secondary px-2 py-0.5 font-inter text-xs">
            <Lock className="size-2.5 shrink-0" strokeWidth={2} />
            <span className="truncate">{domain}</span>
          </span>
        </div>
      )}
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}

/** The product photo: a real one, a hand-painted mug (CC0, WordPress Photo Directory). */
const PRODUCT_PHOTO = "/review-import/mug.webp";

/** The mug's photo, as every page shows it; `className` sizes it. */
export function ProductPhoto({ className = "size-16 @md:size-20" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- decorative, inside an aria-hidden stage
    <img src={PRODUCT_PHOTO} alt="" width={80} height={80} className={cn("shrink-0 rounded-sm bg-secondary object-cover", className)} />
  );
}
