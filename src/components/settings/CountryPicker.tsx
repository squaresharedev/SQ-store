"use client";

import { useTranslations } from "next-intl";
import { useEuCountries } from "@/components/settings/use-eu-countries";
import { CheckboxListPanel, type CheckboxListItem } from "@/components/ui/CheckboxListPanel";
import { SHIPPING_COUNTRY_CODES } from "@/lib/settings/constants";
import { SHIP_ANYWHERE } from "@/types/shipping-policy";

/**
 * COMPACT MULTI-SELECT FOR SHIPPING COUNTRIES, on the shared checkbox panel
 * (ui/CheckboxListPanel): a one-line summary that opens a scrollable list.
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

export function CountryPicker({ value, onChange, summaryLabel, disabled }: CountryPickerProps) {
  const t = useTranslations("Settings");
  const { countryName } = useEuCountries();

  const items: CheckboxListItem<string>[] = [
    // Catch-all "*" first.
    { value: SHIP_ANYWHERE, label: t("shipping.destinations.everywhereElse") },
    ...(SHIPPING_COUNTRY_CODES as readonly string[]).map((code) => ({
      value: code,
      label: countryName(code),
      hint: code,
    })),
  ];

  return (
    <CheckboxListPanel
      items={items}
      value={value}
      onChange={onChange}
      summaryLabel={summaryLabel}
      disabled={disabled}
    />
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
