"use client";

import { useState } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { fieldBaseClass, labelClass, primaryButtonClass } from "./control-styles";
import { Popover } from "./Popover";
import { Calendar } from "./Calendar";
import {
  formatDisplayDate,
  fromISODate,
  isBefore,
  startOfDay,
  startOfMonth,
  toISODate,
} from "@/lib/format/calendar";

/** Range value shape — mirrors the Orders `{ dateFrom, dateTo }` filter (each
 *  an inclusive "YYYY-MM-DD" or null for "no bound"). */
export type DateRangeValue = { from: string | null; to: string | null };

type CommonProps = {
  /** Optional visible field label. */
  label?: string;
  /** Placeholder shown when nothing is selected. */
  placeholder?: string;
  /** Inclusive bounds as "YYYY-MM-DD". */
  min?: string;
  max?: string;
  /** Id for the trigger, so an external <label htmlFor> can point at it. */
  id?: string;
  /** Optional className overrides for the trigger button (e.g., padding). */
  triggerClassName?: string;
};

type DatePickerProps =
  | ({ mode: "single"; value: string | null; onChange: (value: string | null) => void } & CommonProps)
  | ({ mode: "range"; value: DateRangeValue; onChange: (value: DateRangeValue) => void } & CommonProps);

function rangeLabel(from: Date | null, to: Date | null): string {
  if (!from && !to) return "";
  if (from && !to) return `${formatDisplayDate(from)} – …`;
  if (!from && to) return `… – ${formatDisplayDate(to)}`;
  return `${formatDisplayDate(from!)} – ${formatDisplayDate(to!)}`;
}

/**
 * Controlled, on-brand date picker replacing `<input type="date">`. Supports
 * single-date and range modes with a clean value/onChange in ISO
 * "YYYY-MM-DD" strings. Chrome is tokens-only; the range/selected day uses the
 * black `--primary` action token. All keyboard + ARIA behaviour lives in
 * Calendar; positioning + focus return live in Popover.
 */
export function DatePicker(props: DatePickerProps) {
  const { mode, label, placeholder, min, max, id, triggerClassName } = props;
  const [open, setOpen] = useState(false);

  const minDate = fromISODate(min);
  const maxDate = fromISODate(max);

  const selected =
    mode === "single"
      ? { from: fromISODate(props.value), to: null }
      : {
          from: fromISODate(props.value.from),
          to: fromISODate(props.value.to),
        };

  const initialMonth = startOfMonth(
    selected.from ?? selected.to ?? startOfDay(new Date()),
  );

  function handleSelect(date: Date) {
    if (mode === "single") {
      props.onChange(toISODate(date));
      setOpen(false);
      return;
    }
    const from = fromISODate(props.value.from);
    const to = fromISODate(props.value.to);
    // Start a fresh range if none is open or a full one already exists.
    if (!from || to) {
      props.onChange({ from: toISODate(date), to: null });
    } else if (isBefore(date, from)) {
      props.onChange({ from: toISODate(date), to: props.value.from });
    } else {
      props.onChange({ from: props.value.from, to: toISODate(date) });
    }
  }

  const display =
    mode === "single"
      ? selected.from
        ? formatDisplayDate(selected.from)
        : ""
      : rangeLabel(selected.from, selected.to);

  return (
    <div className="flex w-full flex-col gap-1.5">
      {label &&
        (id ? (
          <label htmlFor={id} className={labelClass}>
            {label}
          </label>
        ) : (
          <span className={labelClass}>{label}</span>
        ))}
      <Popover
        open={open}
        onOpenChange={setOpen}
        label={mode === "single" ? "Choose date" : "Choose date range"}
        panelClassName="sm:w-[19rem]"
        trigger={
          <button
            id={id}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen((prev) => !prev)}
            className={cn(
              fieldBaseClass,
              "flex items-center justify-between gap-2 text-left",
              triggerClassName,
            )}
          >
            <span className={cn("truncate", !display && "text-muted-foreground")}>
              {display || placeholder || "Select date"}
            </span>
            <CalendarIcon
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          </button>
        }
      >
        <Calendar
          mode={mode}
          selected={selected}
          onSelect={handleSelect}
          min={minDate}
          max={maxDate}
          initialMonth={initialMonth}
        />
        {mode === "range" && (
          <div className="mt-2 flex justify-end border-t border-border pt-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className={cn(primaryButtonClass, "h-9 py-0")}
            >
              Done
            </button>
          </div>
        )}
      </Popover>
    </div>
  );
}
