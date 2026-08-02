"use client";

import { useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";
import { focusRingClass } from "./control-styles";
import { clamp, hsvToHex, type Hsv } from "@/lib/format/color";

/** Half the hue thumb's width in px, used to keep it inside its track. */
const HUE_THUMB_RADIUS = 12;

/**
 * Shared thumb: a white ring filled with the color it currently points at, so
 * the handle reads as "this is your color" rather than as a generic dot. The
 * dark outer ring keeps it visible on white; the white border keeps it visible
 * on black. It grows a hair while dragging.
 */
function thumbClass(dragging: boolean, size: string) {
  return cn(
    "pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full",
    "border-[3px] border-white shadow-md ring-1 ring-black/20",
    "transition-transform duration-fast ease-standard motion-reduce:transition-none",
    size,
    dragging && "scale-110",
  );
}

/**
 * The keyboard- and pointer-operable color surface: a 2D saturation/brightness
 * square over a hue slider. Both are `role="slider"` with arrow-key control
 * (Home/End jump to the ends) and live `aria-valuetext`. Chrome (borders,
 * thumbs) is tokenized; the gradient fills are the working color VALUES the
 * user is choosing, which the brief permits. Emits HSV upward; the parent
 * converts to strict hex.
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
  const [dragging, setDragging] = useState<"sv" | "hue" | null>(null);

  const hex = hsvToHex(hsv);
  const hueHex = hsvToHex({ h: hsv.h, s: 100, v: 100 });

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
      case "Home": s = 0; break;
      case "End": s = 100; break;
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
    else if (event.key === "Home") h = 0;
    else if (event.key === "End") h = 359;
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
          setDragging("sv");
          svFromPointer(event);
        }}
        onPointerMove={(event) => {
          if (event.buttons === 1) svFromPointer(event);
        }}
        onPointerUp={() => setDragging(null)}
        onPointerCancel={() => setDragging(null)}
        className={cn(
          "relative h-44 w-full touch-none cursor-crosshair rounded-lg",
          // Inset ring instead of a border: the gradient runs edge to edge and
          // still has a defined edge against a white panel. NOT overflow-hidden
          // — the thumb is meant to ride over the edge at the extremes.
          "ring-1 ring-inset ring-black/10",
          focusRingClass,
        )}
        style={{ backgroundColor: hueHex }}
      >
        <div
          className="absolute inset-0 rounded-lg"
          style={{ background: "linear-gradient(to right, #fff, transparent)" }}
        />
        <div
          className="absolute inset-0 rounded-lg"
          style={{ background: "linear-gradient(to top, #000, transparent)" }}
        />
        <span
          aria-hidden
          className={thumbClass(dragging === "sv", "size-5")}
          style={{
            left: `${hsv.s}%`,
            top: `${100 - hsv.v}%`,
            backgroundColor: hex,
          }}
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
          setDragging("hue");
          hueFromPointer(event);
        }}
        onPointerMove={(event) => {
          if (event.buttons === 1) hueFromPointer(event);
        }}
        onPointerUp={() => setDragging(null)}
        onPointerCancel={() => setDragging(null)}
        className={cn(
          "relative h-4 w-full touch-none cursor-ew-resize rounded-full",
          "ring-1 ring-inset ring-black/10",
          focusRingClass,
        )}
        style={{
          background:
            "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)",
        }}
      >
        <span
          aria-hidden
          // Deliberately taller than the track, so it reads as a handle sitting
          // ON the spectrum rather than a notch cut into it.
          className={cn(thumbClass(dragging === "hue", "size-6"), "top-1/2")}
          // Nudge by the thumb radius so it stays fully on the track at both
          // ends instead of hanging off at 0deg and 360deg.
          style={{
            left: `calc(${(hsv.h / 360) * 100}% + ${(0.5 - hsv.h / 360) * (HUE_THUMB_RADIUS * 2)}px)`,
            backgroundColor: hueHex,
          }}
        />
      </div>
    </div>
  );
}
