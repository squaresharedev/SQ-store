"use client";

import { useCallback, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Accessible single-thumb slider (pointer + keyboard). Emits stepped numeric
 * values in `[min, max]`; the consumer maps those to whatever it needs (a radius
 * enum index, a gradient angle, etc). Pill track/thumb per styles.md §3.
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
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;

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
      setFromClientX(event.clientX);
      const onMove = (moveEvent: PointerEvent) => setFromClientX(moveEvent.clientX);
      const onUp = () => {
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
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={cn(
        "group relative flex h-6 touch-none items-center select-none focus-visible:outline-none",
        disabled ? "pointer-events-none opacity-50" : "cursor-pointer",
      )}
    >
      <div className="h-1.5 w-full rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <div
        aria-hidden="true"
        style={{ left: `${pct}%` }}
        className={cn(
          "absolute size-4 -translate-x-1/2 rounded-full border-2 border-primary bg-background shadow-sm",
          "group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-background",
        )}
      />
    </div>
  );
}
