"use client";

import { useRef, useState } from "react";
import { useIsomorphicLayoutEffect } from "@/lib/hooks/useIsomorphicLayoutEffect";

/**
 * An element's own natural size, in px, independent of any CSS transform
 * scaling it down.
 *
 * A `transform: scale()` never changes what an element reports for its own
 * size (offsetWidth/scrollHeight): transforms are paint-only, which is
 * exactly why they are the right tool for a miniature that must still RENDER
 * at full fidelity (see PRODUCT_PAGE_SCALE in ProductPageArtboard). But it
 * also means nothing that wraps a scaled element can size itself from that
 * element directly: this hook is the other half, measuring the natural size
 * once so a caller can shrink a wrapper to match it at whatever scale it's
 * using.
 *
 * scrollHeight rather than offsetHeight: content that overflows its own box
 * (which should never happen here, but would silently under-measure if it
 * did) is still accounted for.
 */
export function useNaturalSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useIsomorphicLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () =>
      // Guard the state write so a no-op measurement can't trigger a render.
      setSize((current) => {
        const next = { width: node.offsetWidth, height: node.scrollHeight };
        return current.width === next.width && current.height === next.height
          ? current
          : next;
      });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { ref, size };
}
