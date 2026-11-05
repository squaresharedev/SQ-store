"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ListPlus } from "lucide-react";
import { SuggestionChip } from "@/components/ui/SuggestionChip";
import { listFormat } from "@/lib/format/intl";
import type { AddOnChoice } from "@/lib/products/add-on-choices";
import { addOnHiddenReason, type AddOnHost } from "@/lib/products/add-on-visibility";
import { suggestAddOns, type AddOnHabits, type AddOnSuggestion } from "@/lib/predictions";

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);

/**
 * THE ONE-TAP GUESS over the add-ons list: what buyers bought with this
 * product, or what the seller offers with their others (lib/predictions.ts
 * suggestAddOns), named in the chip. A tap adds them after what is chosen,
 * and the curved arrow puts the list back for as long as nothing has been
 * pressed since. Nothing shows without a guess, or once the list is full.
 */
export function AddOnsSuggestion({
  habits,
  productId,
  host,
  choices,
  value,
  onChange,
}: {
  habits: AddOnHabits;
  /** The product being edited, never its own add-on. Null on create. */
  productId: string | null;
  host: AddOnHost;
  choices: readonly AddOnChoice[];
  value: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const t = useTranslations("Products.addOnsField.suggestion");
  const locale = useLocale();
  const [applied, setApplied] = useState<{
    suggestion: AddOnSuggestion;
    before: string[];
    after: string[];
  } | null>(null);
  // By content: the storefront editor hands back the saved list as a new array.
  const done = applied !== null && sameIds(applied.after, value);

  // Only what buyers would be shown beside this product is worth a guess.
  const offerable = choices
    .filter((choice) => choice.id !== productId && addOnHiddenReason(choice, host) === null)
    .map((choice) => choice.id);
  const suggestion = done ? applied.suggestion : suggestAddOns(habits, offerable, value);
  if (!suggestion) return null;

  const titles = listFormat(locale, { type: "conjunction" }).format(
    suggestion.ids.map((id) => choices.find((choice) => choice.id === id)?.title ?? ""),
  );

  return (
    <div data-product-add-ons-suggestion={suggestion.reason}>
      <SuggestionChip
        icon={ListPlus}
        label={t(`${suggestion.reason}.label`, { titles })}
        hint={t(`${suggestion.reason}.hint`, { titles, count: suggestion.ids.length })}
        done={done}
        onApply={() => {
          const after = [...value, ...suggestion.ids];
          setApplied({ suggestion, before: [...value], after });
          onChange(after);
        }}
        onUndo={() => {
          if (!applied) return;
          onChange(applied.before);
          setApplied(null);
        }}
      />
    </div>
  );
}
