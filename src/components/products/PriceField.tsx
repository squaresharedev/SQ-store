"use client";

import { cn } from "@/lib/utils";
import { CURRENCIES, type Currency } from "@/types/product";
import {
  errorTextClass,
  fieldBaseClass,
  labelClass,
} from "@/components/ui/control-styles";

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
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={labelClass}>
        Price
      </label>
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
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={cn(fieldBaseClass, "pl-8 pr-32 tabular-nums")}
        />
        <div
          role="group"
          aria-label="Currency"
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
                  "transition-colors duration-180 ease-in-out motion-reduce:transition-none",
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
