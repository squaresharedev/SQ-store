"use client";

import { CopyPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { SuggestionChip } from "@/components/ui/SuggestionChip";

/**
 * "Same as {from}": one tap that copies what an earlier product or storefront
 * holds into an empty block (lib/suggestions/rules.ts SameAs), with an undo arrow
 * once done. Offered, never filled in by itself, because what it copies is a
 * claim the seller makes to buyers. `hint` says what exactly it copies.
 */
export function SameAsChip({
  from,
  hint,
  done,
  onApply,
  onUndo,
}: {
  from: string;
  hint: string;
  done: boolean;
  onApply: () => void;
  onUndo: () => void;
}) {
  const t = useTranslations("Common.actions");
  return (
    <SuggestionChip
      icon={CopyPlus}
      label={t("sameAs", { title: from })}
      hint={hint}
      done={done}
      onApply={onApply}
      onUndo={onUndo}
    />
  );
}
