"use client";

import { cn } from "@/lib/utils";
import { CURRENCIES, type Currency } from "@/types/product";
import {
  errorTextClass,
  fieldBaseClass,
  labelClass,
} from "@/components/ui/control-styles";
import { InfoTip } from "@/components/ui/InfoTip";

const CURRENCY_SYMBOLS: Record<Currency, string> = { EUR: "€", USD: "$" };

/**
 * The price input as one composed control: the currency symbol lives inside
 * the field (updates with the selection) and the EUR/USD toggle sits inline on
 * the right, so "price" reads as a single thing instead of two disconnected
 * fields. EUR (primary market) is the default upstream.
 */
export function PriceField({
  id,
  errorId,
  price,
  currency,
  error,
  onPriceChange,
  onCurrencyChange,
}: {
  id: string;
  errorId: string;
  price: string;
  currency: Currency;
  error?: string;
  onPriceChange: (value: string) => void;
  onCurrencyChange: (value: Currency) => void;
}) {
  // Integer cents for the datapoint below, or undefined while the field is
  // blank or mid-edit. Deliberately the same rounding the save path uses.
  const parsed = Number(price.trim());
  const priceCents =
    price.trim() && Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <label htmlFor={id} className={labelClass}>
          Price
        </label>
        {/* The accessible name deliberately avoids the word "price": it would
            otherwise be a second match for every getByLabel(/price/i) in the
            suite, and an info button is not the field. */}
        <InfoTip label="What you keep">
          What buyers pay. You keep this minus the platform cut.
        </InfoTip>
      </div>
      <div className="relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-medium text-muted-foreground"
        >
          {CURRENCY_SYMBOLS[currency]}
        </span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={price}
          onChange={(event) => onPriceChange(event.target.value)}
          placeholder="9.00"
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          data-product-field="price"
          // The FACT, beside the string a person types. The input holds
          // "129.00" — a decimal with a locale's assumptions in it — while
          // the database, the write payload and the agent surface all deal in
          // integer cents (docs/agent-surface.md B3). A reader takes this and
          // never parses the rendered value.
          data-product-value={priceCents ?? undefined}
          data-product-unit="currency_cents"
          data-product-currency={currency}
          className={cn(fieldBaseClass, "pl-8 pr-32 tabular-nums")}
        />
        <div
          role="group"
          aria-label="Currency"
          data-product-field="currency"
          data-product-value={currency}
          className="absolute inset-y-0 right-1.5 flex items-center"
        >
          {CURRENCIES.map((option) => {
            const active = option === currency;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={active}
                onClick={() => onCurrencyChange(option)}
                className={cn(
                  "rounded-none border border-border px-2.5 py-1 font-inter text-xs font-medium",
                  "transition-colors duration-base ease-standard motion-reduce:transition-none",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "-ml-px first:ml-0",
                  active
                    ? "z-10 border-primary bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {option}
              </button>
            );
          })}
        </div>
      </div>
      {error && (
        <p id={errorId} className={errorTextClass}>
          {error}
        </p>
      )}
    </div>
  );
}
