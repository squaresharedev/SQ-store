"use client";

import * as React from "react";
import { useLocale } from "next-intl";
import { cn } from "@/lib/utils";
import { focusWithinRingClass, helpTextClass, labelClass, transitionClass } from "@/components/ui/control-styles";
import { currencySymbol, currencySymbolLeads, formatWholeNumber } from "@/lib/format/money";

/**
 * A whole amount of money, typed: the currency sign, big digits and an
 * optional unit ("a month") in ONE box, so the figure reads as a figure and
 * never clips. For a number a person changes to see what happens (the plans
 * calculator), where the value is the point of the control. The product
 * form's price is PriceField, which takes cents and a currency switch.
 *
 * At rest the digits are grouped the reader's way ("10,000", "10 000"); while
 * typing they are the bare digits typed, so the caret never jumps over a
 * separator. A usable figure applies as it is typed; leaving the field clamps
 * whatever is there to `max`. The sign sits before or after the digits as the
 * language writes it.
 */
export function AmountField({
  id,
  label,
  value,
  max,
  onChange,
  currency,
  suffix,
  className,
}: {
  id: string;
  label: string;
  /** Whole units of the currency (euros, not cents). Never negative. */
  value: number;
  max: number;
  onChange: (value: number) => void;
  currency: string;
  /** A unit after the figure, e.g. "a month". */
  suffix?: string;
  className?: string;
}) {
  const locale = useLocale();
  // Bare digits while the field is being edited; null at rest.
  const [draft, setDraft] = React.useState<string | null>(null);
  const symbol = currencySymbol(currency, locale);
  const leads = currencySymbolLeads(currency, locale);
  const sign = (
    <span aria-hidden className="shrink-0 text-3xl font-medium text-muted-foreground">
      {symbol}
    </span>
  );

  function commit() {
    if (draft !== null && draft !== "") onChange(Math.min(max, Number(draft)));
    setDraft(null);
  }

  return (
    <div className={className}>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <div
        className={cn(
          "mt-1.5 flex items-baseline gap-2 rounded-sm border border-input bg-background px-4 py-3",
          transitionClass,
          focusWithinRingClass,
        )}
      >
        {leads && sign}
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={draft ?? formatWholeNumber(value, locale)}
          onFocus={(event) => {
            setDraft(String(value));
            // Select the figure, so typing replaces it rather than appends.
            const input = event.currentTarget;
            requestAnimationFrame(() => input.select());
          }}
          onChange={(event) => {
            // Digits only, and never more of them than `max` has.
            const digits = event.target.value.replace(/\D/g, "").slice(0, String(max).length);
            setDraft(digits);
            if (digits !== "" && Number(digits) <= max) onChange(Number(digits));
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          // Opts out of the 16px iOS zoom guard in globals.css, which would
          // otherwise shrink the figure (larger text cannot trigger the zoom).
          data-display-field=""
          // Sized by the box, not by its own content: it can never clip.
          className="w-full min-w-0 flex-1 bg-transparent text-3xl font-semibold tracking-tight tabular-nums text-foreground outline-none"
        />
        {!leads && sign}
        {suffix && <span className={cn(helpTextClass, "shrink-0")}>{suffix}</span>}
      </div>
    </div>
  );
}
