"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useEuCountries } from "@/components/settings/use-eu-countries";
import { SHIPPING_COUNTRY_CODES } from "@/lib/settings/constants";
import { SHIP_ANYWHERE } from "@/types/shipping-policy";
import {
  focusRingClass,
  secondaryButtonClass,
  transitionClass,
} from "@/components/ui/control-styles";

/**
 * COMPACT MULTI-SELECT FOR SHIPPING COUNTRIES.
 *
 * Inline expand/collapse: simpler than a portal dropdown, and the list is long
 * enough (36 codes + "*") that a portal would fight the page's own scroll. The
 * selector collapses to a one-line summary button; expanded, it shows a
 * scrollable checkbox panel.
 *
 * "*" is the SHIP_ANYWHERE sentinel ("Everywhere else"). It lives at the TOP
 * of the list so it is easy to spot rather than buried at the end of 36 codes.
 *
 * Country names come from the browser's Intl.DisplayNames via useEuCountries,
 * which returns the reader's locale. For non-EU codes (GB, US, etc.) not in
 * that list, `countryName(code)` falls back to the raw ISO code.
 */

type CountryPickerProps = {
  /** ISO-2 codes plus optionally "*" (SHIP_ANYWHERE). */
  value: string[];
  onChange: (next: string[]) => void;
  /** Human-readable label shown on the summary button. */
  summaryLabel: string;
  disabled?: boolean;
};

export function CountryPicker({
  value,
  onChange,
  summaryLabel,
  disabled,
}: CountryPickerProps) {
  const t = useTranslations("Settings");
  const { countryName } = useEuCountries();
  const [open, setOpen] = useState(false);

  const selectedSet = new Set(value);

  function toggle(code: string) {
    if (selectedSet.has(code)) {
      onChange(value.filter((c) => c !== code));
    } else {
      onChange([...value, code]);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {/* Summary toggle button */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        disabled={disabled}
        className={cn(
          secondaryButtonClass,
          "w-full justify-between text-left text-sm",
        )}
        aria-expanded={open}
      >
        <span className="min-w-0 truncate">{summaryLabel}</span>
        {open ? (
          <ChevronUp className="size-4 shrink-0 opacity-60" aria-hidden="true" />
        ) : (
          <ChevronDown className="size-4 shrink-0 opacity-60" aria-hidden="true" />
        )}
      </button>

      {open && (
        <div
          className="flex max-h-56 flex-col gap-0.5 overflow-y-auto border border-border bg-background p-2"
          role="group"
        >
          {/* Catch-all "*" first */}
          <CheckRow
            code={SHIP_ANYWHERE}
            label={t("shipping.destinations.everywhereElse")}
            checked={selectedSet.has(SHIP_ANYWHERE)}
            onChange={() => toggle(SHIP_ANYWHERE)}
          />

          {/* All specific country codes */}
          {(SHIPPING_COUNTRY_CODES as readonly string[]).map((code) => (
            <CheckRow
              key={code}
              code={code}
              label={countryName(code)}
              checked={selectedSet.has(code)}
              onChange={() => toggle(code)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** A single checkbox row inside the picker panel. */
function CheckRow({
  code,
  label,
  checked,
  onChange,
}: {
  code: string;
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  const id = `country-check-${code}`;
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer items-center gap-2 px-2 py-1 text-sm text-foreground",
        "rounded-none hover:bg-accent",
        transitionClass,
        focusRingClass,
      )}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className={cn(
          "size-4 shrink-0 accent-foreground",
          focusRingClass,
        )}
      />
      <span className="min-w-0 truncate">
        {label}
        {code !== "*" && (
          <span className="ml-1 text-muted-foreground">{code}</span>
        )}
      </span>
    </label>
  );
}

/**
 * Human-readable summary of a countries selection for the picker button label.
 *
 * Examples (in English):
 *   No countries selected    -> "No countries"
 *   Only "*" selected        -> "Everywhere else"
 *   Two specific codes       -> "IE, DE" (comma-joined)
 *   "*" + two codes          -> "Everywhere else + IE, DE"
 *
 * The caller passes in the translated label strings so this function stays
 * pure and testable without a hook.
 */
export function countryPickerSummary(
  selected: string[],
  opts: {
    noneLabel: string;
    anywhereLabel: string;
    countryName: (code: string) => string;
  },
): string {
  if (selected.length === 0) return opts.noneLabel;

  const hasAnywhere = selected.includes(SHIP_ANYWHERE);
  const specifics = selected.filter((c) => c !== SHIP_ANYWHERE);

  if (hasAnywhere && specifics.length === 0) return opts.anywhereLabel;

  const specificNames = specifics.map(opts.countryName).join(", ");
  if (!hasAnywhere) return specificNames;
  return `${opts.anywhereLabel} + ${specificNames}`;
}
