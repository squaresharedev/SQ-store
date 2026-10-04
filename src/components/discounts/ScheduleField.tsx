"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { DatePicker } from "@/components/ui/DatePicker";
import { Label } from "@/components/ui/label";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Select } from "@/components/ui/select";
import { timeOptions } from "@/lib/format/calendar";

/** A moment as the form holds it: open ("now", or "no end"), or a local date
 *  and time of day the seller picked. */
export type ScheduleValue = { mode: "open" } | { mode: "at"; date: string; time: string };

/**
 * One end of a discount's run: when it starts, or when it ends. A two-way
 * choice ("Now" / "Later", "No end" / "On a date") and, for a set moment, a
 * date and a time of day in the seller's own time zone. Days before `minDate`
 * cannot be picked: a discount is planned forward.
 */
export function ScheduleField({
  label,
  openLabel,
  atLabel,
  value,
  onChange,
  pickDefault,
  minDate,
}: {
  label: string;
  /** "Now" for a start, "No end" for an end. */
  openLabel: string;
  /** "Later" for a start, "On a date" for an end. */
  atLabel: string;
  value: ScheduleValue;
  onChange: (next: ScheduleValue) => void;
  /** What choosing a date opens on. Asked for at the click, so it is never a
   *  moment that has already passed. */
  pickDefault: () => ScheduleValue;
  /** The earliest day on offer ("YYYY-MM-DD"): today, or a later start. */
  minDate: string;
}) {
  const t = useTranslations("Discounts.form.schedule");
  const dateId = useId();
  const timeId = useId();

  return (
    <div className="flex flex-col gap-3">
      <SegmentedControl
        ariaLabel={label}
        value={value.mode}
        options={[
          { value: "open", label: openLabel },
          { value: "at", label: atLabel },
        ]}
        onChange={(mode) => onChange(mode === "open" ? { mode } : pickDefault())}
      />
      {value.mode === "at" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={dateId}>{t("date")}</Label>
            <DatePicker
              id={dateId}
              mode="single"
              value={value.date}
              min={minDate}
              onChange={(date) => onChange({ ...value, date: date ?? minDate })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={timeId}>{t("time")}</Label>
            <Select
              id={timeId}
              value={value.time}
              options={timeOptions(value.time).map((slot) => ({ value: slot, label: slot }))}
              onChange={(time) => onChange({ ...value, time })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
