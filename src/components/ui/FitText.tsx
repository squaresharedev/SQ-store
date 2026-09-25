"use client";

import * as React from "react";

import { useIsomorphicLayoutEffect } from "@/lib/hooks/useIsomorphicLayoutEffect";
import { cn } from "@/lib/utils";

/**
 * Shrinks its single line of text to fit the width it is given, instead of
 * clipping it with an ellipsis. It never grows past the inherited font size.
 *
 * `measure` is the SETTLED string. It is laid out in an invisible ghost at the
 * inherited size and compared with the container, so the scale depends on the
 * final figure rather than whatever a count-up animation currently shows (the
 * visible text would otherwise resize on every frame). The scale is applied as
 * an `em` multiplier, so the caller keeps setting the base size with its usual
 * text-* classes and the line box stays in flow.
 */
export function FitText({
  measure,
  children,
  className,
}: {
  measure: string;
  children: React.ReactNode;
  className?: string;
}) {
  const boxRef = React.useRef<HTMLSpanElement>(null);
  const ghostRef = React.useRef<HTMLSpanElement>(null);
  const [scale, setScale] = React.useState(1);

  useIsomorphicLayoutEffect(() => {
    const box = boxRef.current;
    const ghost = ghostRef.current;
    if (!box || !ghost) return;

    function fit() {
      if (!box || !ghost) return;
      const available = box.clientWidth;
      const needed = ghost.scrollWidth;
      if (available === 0 || needed === 0) return;
      setScale(Math.min(1, available / needed));
    }

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <span
      ref={boxRef}
      className={cn("relative block whitespace-nowrap", className)}
    >
      <span
        ref={ghostRef}
        aria-hidden="true"
        className="pointer-events-none invisible absolute left-0 top-0 whitespace-nowrap"
      >
        {measure}
      </span>
      <span style={{ fontSize: `${scale}em` }}>{children}</span>
    </span>
  );
}
