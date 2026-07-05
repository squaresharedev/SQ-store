"use client";

import { useRef } from "react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";
import { clamp, type Hsv } from "@/lib/format/color";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const THUMB =
  "pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-sm ring-1 ring-black/30";

/**
 * The keyboard- and pointer-operable color surface: a 2D saturation/brightness
 * square over a hue slider. Both are `role="slider"` with arrow-key control and
 * live `aria-valuetext`. Chrome (borders, thumbs) is tokenized; the gradient
 * fills are the working color VALUES the user is choosing, which the brief
 * permits. Emits HSV upward; the parent converts to strict hex.
 */
export function ColorArea({
  hsv,
  onChange,
}: {
  hsv: Hsv;
  onChange: (hsv: Hsv) => void;
}) {
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);

  function svFromPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = svRef.current?.getBoundingClientRect();
    if (!rect) return;
    const s = clamp((event.clientX - rect.left) / rect.width, 0, 1) * 100;
    const v = (1 - clamp((event.clientY - rect.top) / rect.height, 0, 1)) * 100;
    onChange({ h: hsv.h, s, v });
  }

  function hueFromPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = hueRef.current?.getBoundingClientRect();
    if (!rect) return;
    const h = clamp((event.clientX - rect.left) / rect.width, 0, 1) * 360;
    onChange({ ...hsv, h });
  }

  function onSvKey(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 10 : 2;
    let { s, v } = hsv;
    switch (event.key) {
      case "ArrowLeft": s -= step; break;
      case "ArrowRight": s += step; break;
      case "ArrowUp": v += step; break;
      case "ArrowDown": v -= step; break;
      default: return;
    }
    event.preventDefault();
    onChange({ h: hsv.h, s: clamp(s, 0, 100), v: clamp(v, 0, 100) });
  }

  function onHueKey(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 15 : 4;
    let h = hsv.h;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") h -= step;
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") h += step;
    else return;
    event.preventDefault();
    onChange({ ...hsv, h: (h + 360) % 360 });
  }

  return (
    <div className="space-y-3">
      <div
        ref={svRef}
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsv.s)}
        aria-valuetext={`${Math.round(hsv.s)}% saturation, ${Math.round(hsv.v)}% brightness`}
        onKeyDown={onSvKey}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          svFromPointer(event);
        }}
        onPointerMove={(event) => {
          if (event.buttons === 1) svFromPointer(event);
        }}
        className={cn(
          "relative h-40 w-full touch-none cursor-crosshair rounded-sm border border-border",
          FOCUS_RING,
        )}
        style={{ backgroundColor: `hsl(${Math.round(hsv.h)}, 100%, 50%)` }}
      >
        <div
          className="absolute inset-0 rounded-sm"
          style={{ background: "linear-gradient(to right, #fff, transparent)" }}
        />
        <div
          className="absolute inset-0 rounded-sm"
          style={{ background: "linear-gradient(to top, #000, transparent)" }}
        />
        <span
          aria-hidden
          className={THUMB}
          style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%` }}
        />
      </div>

      <div
        ref={hueRef}
        role="slider"
        tabIndex={0}
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        aria-valuetext={`${Math.round(hsv.h)} degrees`}
        onKeyDown={onHueKey}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          hueFromPointer(event);
        }}
        onPointerMove={(event) => {
          if (event.buttons === 1) hueFromPointer(event);
        }}
        className={cn(
          "relative h-4 w-full touch-none cursor-ew-resize rounded-full border border-border",
          FOCUS_RING,
        )}
        style={{
          background:
            "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)",
        }}
      >
        <span
          aria-hidden
          className={cn(THUMB, "top-1/2")}
          style={{ left: `${(hsv.h / 360) * 100}%` }}
        />
      </div>
    </div>
  );
}
