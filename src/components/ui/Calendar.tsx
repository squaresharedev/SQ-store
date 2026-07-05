"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ghostButtonClass } from "./control-styles";
import {
  MONTH_LABEL,
  WEEKDAY_FULL,
  WEEKDAY_LABELS,
  addDays,
  addMonths,
  buildMonthGrid,
  clampDate,
  fullDateLabel,
  isAfter,
  isBefore,
  isOutsideRange,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
} from "@/lib/format/calendar";

export type CalendarRange = { from: Date | null; to: Date | null };

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

const NAV_BUTTON = cn(
  "flex size-8 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-180 ease-in-out motion-reduce:transition-none hover:bg-accent hover:text-foreground",
  FOCUS_RING,
);

/**
 * ARIA date grid with full keyboard parity to a native picker: arrows move a
 * day (roving tabindex), PageUp/Down change month (+Shift = year), Home/End
 * jump within the week, Enter/Space selects. Selection is reported via
 * `onSelect`; the owning DatePicker holds the value and decides single vs range
 * semantics. `selected.from` alone is the single-mode selection.
 */
export function Calendar({
  mode,
  selected,
  onSelect,
  min,
  max,
  initialMonth,
}: {
  mode: "single" | "range";
  selected: CalendarRange;
  onSelect: (date: Date) => void;
  min: Date | null;
  max: Date | null;
  initialMonth: Date;
}) {
  const today = startOfDay(new Date());
  const [month, setMonth] = useState(startOfMonth(initialMonth));
  const [focused, setFocused] = useState<Date>(() =>
    clampDate(selected.from ?? selected.to ?? initialMonth, min, max),
  );
  const [hover, setHover] = useState<Date | null>(null);
  const gridRef = useRef<HTMLTableElement>(null);

  // After a keyboard move, pull DOM focus onto the newly focused cell — but
  // only while focus already lives in the grid (never steal it on open).
  useEffect(() => {
    const grid = gridRef.current;
    if (grid?.contains(document.activeElement)) {
      grid.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
  }, [focused]);

  function moveFocus(next: Date) {
    const clamped = clampDate(next, min, max);
    setFocused(clamped);
    if (!isSameMonth(clamped, month)) setMonth(startOfMonth(clamped));
  }

  function onKeyDown(event: KeyboardEvent<HTMLTableElement>) {
    const weekday = (focused.getDay() + 6) % 7; // Monday-first index
    let next: Date | null = null;
    switch (event.key) {
      case "ArrowLeft": next = addDays(focused, -1); break;
      case "ArrowRight": next = addDays(focused, 1); break;
      case "ArrowUp": next = addDays(focused, -7); break;
      case "ArrowDown": next = addDays(focused, 7); break;
      case "Home": next = addDays(focused, -weekday); break;
      case "End": next = addDays(focused, 6 - weekday); break;
      case "PageUp": next = addMonths(focused, event.shiftKey ? -12 : -1); break;
      case "PageDown": next = addMonths(focused, event.shiftKey ? 12 : 1); break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (!isOutsideRange(focused, min, max)) onSelect(focused);
        return;
      default:
        return;
    }
    event.preventDefault();
    moveFocus(next);
  }

  // Range span (with live hover preview while picking the second endpoint).
  const previewEnd =
    selected.to ??
    (mode === "range" && selected.from && !selected.to ? hover : null);
  const lo =
    selected.from && previewEnd
      ? isBefore(selected.from, previewEnd) ? selected.from : previewEnd
      : null;
  const hi =
    selected.from && previewEnd
      ? isAfter(selected.from, previewEnd) ? selected.from : previewEnd
      : null;

  const grid = buildMonthGrid(month);
  const weeks = Array.from({ length: 6 }, (_, w) =>
    grid.slice(w * 7, w * 7 + 7),
  );

  function goToday() {
    const target = clampDate(today, min, max);
    setMonth(startOfMonth(target));
    setFocused(target);
  }

  return (
    <div className="select-none">
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setMonth(addMonths(month, -1))}
          aria-label="Previous month"
          className={NAV_BUTTON}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </button>
        <span aria-live="polite" className="text-sm font-medium text-foreground">
          {MONTH_LABEL.format(month)}
        </span>
        <button
          type="button"
          onClick={() => setMonth(addMonths(month, 1))}
          aria-label="Next month"
          className={NAV_BUTTON}
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      </div>

      <table
        ref={gridRef}
        role="grid"
        aria-label={MONTH_LABEL.format(month)}
        onKeyDown={onKeyDown}
        className="w-full border-collapse"
      >
        <thead>
          <tr>
            {WEEKDAY_LABELS.map((day, index) => (
              <th
                key={day}
                scope="col"
                className="pb-1 text-center font-inter text-xs font-normal text-muted-foreground"
              >
                <span aria-hidden="true">{day}</span>
                <span className="sr-only">{WEEKDAY_FULL[index]}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, w) => (
            <tr key={w}>
              {week.map((day) => {
                const disabled = isOutsideRange(day, min, max);
                const inMonth = isSameMonth(day, month);
                const isEndpoint =
                  isSameDay(day, selected.from) || isSameDay(day, selected.to);
                const between =
                  !!lo && !!hi && isAfter(day, lo) && isBefore(day, hi);
                const isToday = isSameDay(day, today);
                return (
                  <td
                    key={day.getTime()}
                    role="gridcell"
                    aria-selected={isEndpoint || between ? true : undefined}
                    className="p-0 text-center"
                  >
                    <button
                      type="button"
                      tabIndex={isSameDay(day, focused) ? 0 : -1}
                      data-autofocus={isSameDay(day, focused) ? "" : undefined}
                      disabled={disabled}
                      aria-disabled={disabled || undefined}
                      aria-current={isToday ? "date" : undefined}
                      aria-label={fullDateLabel(day)}
                      onClick={() => onSelect(day)}
                      onFocus={() => setFocused(day)}
                      onMouseEnter={() =>
                        mode === "range" ? setHover(day) : undefined
                      }
                      className={cn(
                        "mx-auto my-0.5 flex size-9 items-center justify-center text-sm transition-colors duration-180 ease-in-out motion-reduce:transition-none",
                        FOCUS_RING,
                        between
                          ? "rounded-none bg-accent text-foreground"
                          : "rounded-sm",
                        isEndpoint
                          ? "bg-primary font-medium text-primary-foreground hover:bg-primary/90"
                          : !between && "hover:bg-accent",
                        !inMonth && !isEndpoint && "text-muted-foreground/60",
                        inMonth && !isEndpoint && !between && "text-foreground",
                        isToday && !isEndpoint && "font-semibold",
                        disabled &&
                          "pointer-events-none text-muted-foreground/40",
                      )}
                    >
                      {day.getDate()}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-1 flex justify-center">
        <button
          type="button"
          onClick={goToday}
          className={cn(ghostButtonClass, "h-8 px-3 py-0 text-sm")}
        >
          Today
        </button>
      </div>
    </div>
  );
}
