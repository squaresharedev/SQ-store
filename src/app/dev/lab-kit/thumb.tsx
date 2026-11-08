"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** The width a whole page is drawn at in a preset tile before it is scaled down: the dashboard's content column. */
export const LAB_THUMB_WIDTH = 1240;
/** How much of a page's height a tile shows, at that width. */
export const LAB_THUMB_HEIGHT = 1000;

/**
 * A whole page drawn at the dashboard's width and scaled down to fit its box,
 * for a lab whose presets are pages, not components. Not interactive (`inert`):
 * the tile's press is an overlay button, never a wrapper, since the page has
 * buttons of its own and nested buttons are a hydration error.
 */
export function LabThumb({
  children,
  width = LAB_THUMB_WIDTH,
  maxHeight = LAB_THUMB_HEIGHT,
}: {
  children: ReactNode;
  width?: number;
  maxHeight?: number;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  const [height, setHeight] = useState(maxHeight);
  useEffect(() => {
    const box = outer.current;
    const content = inner.current;
    if (!box || !content) return;
    const observer = new ResizeObserver(() => {
      setScale(box.clientWidth / width);
      setHeight(Math.min(content.offsetHeight, maxHeight));
    });
    observer.observe(box);
    observer.observe(content);
    return () => observer.disconnect();
  }, [width, maxHeight]);
  return (
    <div ref={outer} className="relative overflow-hidden rounded-md border border-border bg-background" style={{ height: height * scale }}>
      <div ref={inner} inert className="pointer-events-none absolute top-0 left-0 origin-top-left" style={{ width, transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}
