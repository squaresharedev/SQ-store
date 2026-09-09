"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Accessible single-thumb slider (pointer + keyboard). Emits stepped numeric
 * values in `[min, max]`; the consumer maps those to whatever it needs (a radius
 * enum index, a gradient angle, etc). Pill track/thumb per styles.md §3.
 *
 * IT LIGHTS UP WHEN ASKED FOR. Focus, the drag itself, and `highlighted` (set
 * by a caller pointing at this exact control from elsewhere in the panel) put
 * the fill, the rail and the thumb in the accent — see the `.ss-slider` block
 * in globals.css, which owns the whole lit look so the states cannot drift
 * apart. NOT hover: a passing cursor lights nothing. All this file does is
 * name the parts, say when a drag is running, and forward `highlighted`.
 */
export function Slider({
  id,
  value,
  min = 0,
  max,
  step = 1,
  onChange,
  ariaLabel,
  valueText,
  disabled = false,
  highlighted = false,
}: {
  id?: string;
  value: number;
  min?: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  ariaLabel: string;
  valueText?: string;
  disabled?: boolean;
  /** Lit in the accent because something else pointed at this exact slider
   *  (a summoned field), not because a pointer is on it. See `data-highlighted`
   *  in the `.ss-slider` rules — same lit look as focus/dragging, one more way
   *  in. */
  highlighted?: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  /**
   * A drag is running. Its whole job is to KEEP the control lit once the
   * pointer has left the track — which happens on nearly every drag, since the
   * bar is 6px tall and the hand does not travel along it. Without this the
   * slider goes dark under its own thumb mid-gesture.
   */
  const [dragging, setDragging] = useState(false);

  const setFromClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const ratio =
        rect.width > 0
          ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
          : 0;
      const raw = min + ratio * (max - min);
      const snapped = Math.round(raw / step) * step;
      const clamped = Math.min(max, Math.max(min, snapped));
      if (clamped !== value) onChange(clamped);
    },
    [min, max, step, value, onChange],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled || event.button !== 0) return;
      event.preventDefault();
      setDragging(true);
      setFromClientX(event.clientX);
      const onMove = (moveEvent: PointerEvent) => setFromClientX(moveEvent.clientX);
      const onUp = () => {
        setDragging(false);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [disabled, setFromClientX],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      let next = value;
      switch (event.key) {
        case "ArrowRight":
        case "ArrowUp":
          next = Math.min(max, value + step);
          break;
        case "ArrowLeft":
        case "ArrowDown":
          next = Math.max(min, value - step);
          break;
        case "Home":
          next = min;
          break;
        case "End":
          next = max;
          break;
        default:
          return;
      }
      event.preventDefault();
      if (next !== value) onChange(next);
    },
    [disabled, max, min, step, value, onChange],
  );

  return (
    <div
      ref={trackRef}
      id={id}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      aria-disabled={disabled || undefined}
      // Read by the .ss-slider rules, which keep the control lit for as long
      // as the gesture lasts. Absent rather than "false": the CSS asks whether
      // the attribute is there at all.
      data-dragging={dragging || undefined}
      data-highlighted={highlighted || undefined}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={cn(
        "ss-slider group relative flex h-6 touch-none items-center select-none focus-visible:outline-none",
        disabled ? "pointer-events-none opacity-50" : "cursor-pointer",
      )}
    >
      {/* The rail, and the part of it already spent. Both take their colour
          from the lit variables rather than from a fixed token, so the whole
          bar answers a hover — including a slider at zero, which has no fill
          for the accent to land on. */}
      <div className="h-1.5 w-full rounded-full bg-(--slider-rail) transition-colors duration-base ease-standard motion-reduce:transition-none">
        <div
          className="h-full rounded-full bg-(--slider-ink) transition-colors duration-base ease-standard motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div
        aria-hidden="true"
        style={{ left: `${pct}%` }}
        // No `ring-*` focus utility here, alone among the product's controls:
        // the halo and a Tailwind ring are both box-shadow, and the .ss-slider
        // rules would win and erase the ring. The focus ring is drawn in the
        // same chain as the halo instead — same 2px of --ring, same offset —
        // see the .ss-slider-thumb block in globals.css.
        className="ss-slider-thumb absolute size-4 -translate-x-1/2 rounded-full border-2 border-(--slider-ink) bg-background"
      />
    </div>
  );
}
