"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { skeletonClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";

/**
 * How near the screen a lazy tile has to be to come alive: within a screen's
 * height above or below, so it is running by the time it scrolls in, and taken
 * down again once it is a screen away.
 */
export const LAB_LAZY_MARGIN = "100% 0px";

/** A waiting tile's height (px) before it has been drawn once: about a typical tile's. */
export const LAB_LAZY_HEIGHT = 320;

/**
 * A preset tile's live render, mounted only while it is on or near the screen
 * (LAB_LAZY_MARGIN) and taken down once it is well off it, so a tab of many
 * animated tiles, WebGL fields (Chrome keeps about 16 contexts a page) or
 * scaled-down whole pages costs what can be seen, not the whole tab. While it
 * waits it holds the height it last drew at (or `height`, before it has drawn),
 * so the page never jumps. `keep` leaves it mounted once it has drawn: for a
 * tile whose setup is the costly part, not its running.
 */
export function LabLazy({
  children,
  height = LAB_LAZY_HEIGHT,
  keep = false,
  className,
}: {
  children: ReactNode;
  height?: number;
  keep?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Without an IntersectionObserver (an old browser) every tile simply draws.
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");
  const [seen, setSeen] = useState(false);
  const [drawnAt, setDrawnAt] = useState<number | null>(null);
  const live = near || (keep && seen);

  useEffect(() => {
    const box = ref.current;
    if (!box || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const isNear = entries.some((entry) => entry.isIntersecting);
        setNear(isNear);
        if (isNear) setSeen(true);
      },
      { rootMargin: LAB_LAZY_MARGIN },
    );
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  // While it is drawn, its height is remembered, so it keeps its room once taken down.
  useEffect(() => {
    const box = ref.current;
    if (!box || !live || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setDrawnAt(box.offsetHeight));
    observer.observe(box);
    return () => observer.disconnect();
  }, [live]);

  return (
    <div ref={ref} className={className} data-lab-lazy={live ? "live" : "waiting"} style={live ? undefined : { height: drawnAt ?? height }}>
      {live ? children : <div className={cn(skeletonClass, "size-full rounded-md")} />}
    </div>
  );
}
