"use client";

import { cn } from "@/lib/utils";
import { CURRENCIES, type Currency } from "@/types/product";
import {
  errorTextClass,
  fieldBaseClass,
  labelClass,
} from "@/components/ui/control-styles";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { parseFormPriceCents } from "@/lib/products/price";

const CURRENCY_SYMBOLS: Record<Currency, string> = { EUR: "€", USD: "$" };

/**
 * The price input as one composed control: the currency symbol lives inside
 * the field (updates with the selection) and the EUR/USD toggle sits inline on
 * the right, so "price" reads as a single thing instead of two disconnected
 * fields. EUR (primary market) is the default upstream.
 *
 * On blur the field normalises to two decimal places so what the seller reads
 * before saving is exactly what gets stored. "129" becomes "129.00", "1,50"
 * becomes "1.50" — no silent truncation or rounding on Save.
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
  // blank or mid-edit. Deliberately the same parser the save path uses, so
  // the attribute and the DB write can never disagree.
  const parseResult = parseFormPriceCents(price);
  const priceCents = parseResult.ok ? parseResult.cents : null;

  function handleBlur() {
    // Normalise to two decimal places on blur so the seller sees the stored
    // representation before pressing Save. "129" -> "129.00", "1,50" ->
    // "1.50". Only runs when the field holds a valid price; an invalid value
    // is left alone so the error message is still accurate.
    if (priceCents !== null) {
      onPriceChange((priceCents / 100).toFixed(2));
    }
  }

  return (
    <div className="space-y-1.5">
      {/* No "?" here. Everyone selling something knows what a price is, and an
          info button beside the one field that needs no explanation is what
          teaches a seller to stop reading the ones that do. */}
      <div className="flex items-center">
        <label htmlFor={id} className={labelClass}>
          Price
        </label>
        <RequiredMark />
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
          onBlur={handleBlur}
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
