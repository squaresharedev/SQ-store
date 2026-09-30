"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { DARK_INK } from "./product-page-maps";

/** The bar's hairline: the dark ink at the same alpha as ruleColor's. */
const STICKY_BAR_RULE = "rgba(23,23,23,0.12)";

/**
 * The bar pinned to the foot of a narrow screen, so the page's one action is
 * always in reach: "Buy now" on the product page, "Pay" on the checkout.
 * Hidden once the page is wide enough for the action to sit beside the
 * content (@3xl), where the buy box is sticky instead.
 *
 * A fixed white bar with dark ink, whatever the storefront's background: it
 * floats over the page, and one legible surface beats re-deriving an ink for
 * whatever happens to scroll beneath it.
 *
 * `fixed` for a buyer; `sticky` inside the editor's artboard, where a fixed
 * bar would pin itself to the seller's screen instead of the preview.
 *
 * IT STEPS ASIDE WHILE THE PAGE'S OWN BUTTON IS ON SCREEN (`watch`). The bar
 * is a second place to press the same button, and a bar floating over the
 * foot of the screen covers whatever is there, which, once a buyer has
 * scrolled to it, is the very button it stands in for: seen on the checkout,
 * where the bar sat over the form's own Pay button. So it watches that button
 * (an IntersectionObserver, which also honours any window the page scrolls
 * inside, like the editor's phone view) and slides away the moment any of it
 * shows, and back once it has scrolled off again. While away it is `inert`:
 * out of the tab order and the accessibility tree, since the button it
 * duplicates is right there.
 *
 * It starts AWAY and appears once the observer has answered, so a page that
 * opens with its button already in view never flashes the bar. Where there is
 * no observer, or nothing to watch, it simply stays.
 * tests/e2e/80-* and 81-* hold the promise end to end: scrolled top to bottom
 * at phone widths, no Pay or Buy button is ever covered.
 */
export function StickyBar({
  preview,
  hotspot,
  watch,
  className,
  attributes,
  children,
}: {
  preview: boolean;
  /** The setting a click on the bar opens in the editor. */
  hotspot?: string;
  /**
   * A selector for the page's own action, the one this bar stands in for. It
   * is looked up inside the same page (`[data-page-root]`), never in the bar
   * itself, so a preview with several pages side by side watches its own.
   */
  watch?: string;
  className?: string;
  attributes?: Record<`data-${string}`, string>;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // null = not known yet (the first paint, and the server's).
  const [actionInView, setActionInView] = useState<boolean | null>(null);

  useEffect(() => {
    const bar = ref.current;
    if (!bar) return;
    const scope = bar.parentElement?.closest("[data-page-root]") ?? document;
    const target = watch
      ? Array.from(scope.querySelectorAll(watch)).find((element) => !bar.contains(element))
      : undefined;
    if (!target || typeof IntersectionObserver === "undefined") {
      setActionInView(false);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setActionInView(entry.isIntersecting));
    observer.observe(target);
    return () => observer.disconnect();
  }, [watch]);

  const away = actionInView !== false;
  return (
    <div
      ref={ref}
      className={cn(
        "inset-x-0 bottom-0 z-20 flex items-center gap-4 border-t bg-white px-4 py-3 @3xl:hidden",
        "transition-[translate,opacity] duration-base ease-standard motion-reduce:transition-none",
        away && "pointer-events-none translate-y-full opacity-0",
        preview ? "sticky" : "fixed",
        className,
      )}
      style={{ color: DARK_INK, borderColor: STICKY_BAR_RULE }}
      inert={away}
      data-sticky-bar={away ? "away" : "shown"}
      data-setting-hotspot={hotspot}
      {...attributes}
    >
      {children}
    </div>
  );
}
