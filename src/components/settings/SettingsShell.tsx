"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
// The settings map itself lives in @/lib/search/nav-constants so the universal
// search registry indexes exactly what this rail renders.
import { SETTINGS_NAV } from "@/lib/search/nav-constants";

function navItemClasses(active: boolean, danger?: boolean) {
  return cn(
    "flex shrink-0 snap-start items-center gap-2.5 rounded-[0.375rem] px-3 py-2.5 text-sm font-medium",
    "transition-colors duration-base ease-standard motion-reduce:transition-none",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    active
      ? danger
        ? "bg-destructive/5 text-destructive"
        : "bg-accent text-foreground"
      : danger
        ? "text-muted-foreground hover:bg-destructive/5 hover:text-destructive"
        : "text-muted-foreground hover:bg-accent hover:text-foreground",
  );
}

/**
 * Settings sub-navigation: a swipeable tab strip that becomes a second sidebar,
 * sitting flush against the main dashboard rail, once there is room for both.
 *
 * TWO BREAKPOINTS, deliberately, because they answer different questions.
 *
 * The LAYOUT flips at `lg`, not at `md`. The dashboard rail pins itself open at
 * `md` (768px) and eats 16rem; a second 15rem rail beside it left roughly 17rem
 * for the settings content itself, which is narrower than the same page gets on
 * a phone. Between the two breakpoints the strip stays horizontal and the
 * content keeps the whole width the dashboard rail leaves it.
 *
 * The HEADING flips at `md`, because what it duplicates is the mobile top bar's
 * "Settings" title, and that bar is what disappears at `md`.
 *
 * The strip is driven by the FINGER, not by a scrollbar: `.swipe-x` hides the
 * bar (see globals.css) and a fade at each end that still has tabs behind it
 * carries the "there's more this way" signal instead.
 */
export function SettingsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const navRef = React.useRef<HTMLElement>(null);
  const [overflows, setOverflows] = React.useState({ start: false, end: false });

  /** Which ends of the strip still have tabs hidden past them. */
  const syncEdges = React.useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    const max = nav.scrollWidth - nav.clientWidth;
    // 1px slack: fractional scroll offsets otherwise leave a fade stuck on at
    // the very end of the strip.
    setOverflows({
      start: nav.scrollLeft > 1,
      end: nav.scrollLeft < max - 1,
    });
  }, []);

  // On mobile the sub-nav scrolls horizontally, so the active tab can start
  // off-screen (e.g. landing on Danger zone). Nudge it into view on route
  // change. Instant scroll respects reduced-motion by construction.
  React.useEffect(() => {
    const active = navRef.current?.querySelector<HTMLElement>(
      '[aria-current="page"]',
    );
    active?.scrollIntoView({ block: "nearest", inline: "center" });
    syncEdges();
  }, [pathname, syncEdges]);

  // Resize covers both a rotate and the lg breakpoint, where the strip becomes
  // a plain column and neither fade should survive.
  React.useEffect(() => {
    window.addEventListener("resize", syncEdges);
    return () => window.removeEventListener("resize", syncEdges);
  }, [syncEdges]);

  const nav = SETTINGS_NAV.map((item) => {
    const active = pathname.startsWith(item.href);
    const Icon = item.icon;
    const danger = item.danger;

    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={navItemClasses(active, danger)}
      >
        <Icon aria-hidden className="size-4" />
        {item.label}
      </Link>
    );
  });

  return (
    <div className="lg:flex lg:items-stretch">
      {/* Settings secondary sidebar. Full-height sticky rail from lg up, a
          swipeable tab strip below it. */}
      {/* Sticks BELOW the shell's h-14 top bar (not at top-0), so the rail's
          heading can't slide under the bar's translucent backdrop. */}
      <aside className="lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)] lg:w-60 lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-border">
        {/* Below md the top bar already says "Settings" in full, so the rail
            heading is only announced, never drawn — repeating it cost a screen
            of height for a word already on screen. It stays in the document so
            the cards' h2s still hang off a page-level h1. Padding tracks
            whatever it sits above: the content column below md, the rail at lg. */}
        <div className="md:px-10 md:pt-8 lg:px-4">
          <h1 className="sr-only text-lg font-semibold tracking-tight text-foreground md:not-sr-only">
            Settings
          </h1>
        </div>
        <div className="mt-4 lg:mt-6">
          {/* The fades are scoped to the strip itself so they can't paint over
              the rule below, and the rule sits outside the scroller so it
              reads as the edge of the section rather than part of the swipe. */}
          <div className="relative">
            <nav
              ref={navRef}
              onScroll={syncEdges}
              aria-label="Settings sections"
              // Gutters follow the content column's so the first tab lines up
              // with the left edge of the cards below it.
              className="swipe-x flex snap-x gap-1 overflow-x-auto scroll-px-6 px-6 pb-3 md:scroll-px-10 md:px-10 lg:snap-none lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-3 lg:pb-6"
            >
              {nav}
            </nav>
            {/* Each fade is only lit while there are tabs behind it, so it
                reads as "keep swiping" rather than as permanent decoration. */}
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-background to-transparent lg:hidden",
                "transition-opacity duration-base ease-standard motion-reduce:transition-none",
                overflows.start ? "opacity-100" : "opacity-0",
              )}
            />
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background to-transparent lg:hidden",
                "transition-opacity duration-base ease-standard motion-reduce:transition-none",
                overflows.end ? "opacity-100" : "opacity-0",
              )}
            />
          </div>
          <div aria-hidden className="border-b border-border lg:hidden" />
        </div>
      </aside>

      {/* Content column. */}
      <div className="min-w-0 flex-1 px-6 py-8 md:px-10 md:py-12">
        <div className="mx-auto w-full max-w-2xl">{children}</div>
      </div>
    </div>
  );
}
