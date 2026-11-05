"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { SameAsChip } from "@/components/ui/SameAsChip";
import { SuggestionChip } from "@/components/ui/SuggestionChip";
import type { ProductSuggestions } from "@/lib/predictions";
import { guessSizes } from "@/lib/products/option-guesses";
import { copyOptionGroups, groupFromPreset, SIZE_PRESET } from "@/lib/products/option-presets";
import { OPTION_GROUPS_MAX, OPTIONS_TOTAL_MAX, type ProductOptionGroup } from "@/types/product";
import type { ExtraSectionId } from "./FormExtrasPicker";
import { safetyStarted, type DetailsFormValues } from "./form-values";

/** The parts of a new product a starter can fill. */
export type Starter = { optionGroups: ProductOptionGroup[]; details: DetailsFormValues };

const mintId = () => crypto.randomUUID();

/**
 * A NEW PRODUCT'S HEAD START, under its title: "Same as {last product}" copies
 * that one product's options, specifications and maker in one tap, and a title
 * that is plainly clothing ("Linen shirt", "Kapuzenpullover") offers its sizes.
 * Each is one tap in, and the curved arrow it leaves behind is one tap out,
 * for as long as nothing it filled has been changed since.
 *
 * Nothing shows when there is nothing sure to offer. The owner fills the form
 * (`onApply`, which opens the sections it filled and says which it opened) and
 * puts it back (`onUndo`, which closes them again).
 */
export function StarterSuggestions({
  sameAs,
  title,
  isDigital,
  current,
  onApply,
  onUndo,
}: {
  sameAs?: ProductSuggestions["sameAs"];
  title: string;
  isDigital: boolean;
  current: Starter;
  onApply: (next: Starter, open: readonly ExtraSectionId[]) => ExtraSectionId[];
  onUndo: (before: Starter, opened: readonly ExtraSectionId[]) => void;
}) {
  const t = useTranslations("Products.optionsField");
  const [applied, setApplied] = useState<{
    id: "sameAs" | "sizes";
    /** What the chip said when tapped, kept while the title changes under it. */
    label: string;
    before: Starter;
    after: Starter;
    opened: ExtraSectionId[];
  } | null>(null);
  // Still exactly as the tap left it: anything changed since and the arrow
  // goes, because taking it back would also take back the seller's own edit.
  const done = (id: "sameAs" | "sizes") =>
    applied?.id === id &&
    applied.after.optionGroups === current.optionGroups &&
    applied.after.details === current.details;

  function apply(id: "sameAs" | "sizes", label: string, after: Starter, open: readonly ExtraSectionId[]) {
    setApplied({ id, label, before: current, after, opened: onApply(after, open) });
  }

  function undo() {
    if (!applied) return;
    onUndo(applied.before, applied.opened);
    setApplied(null);
  }

  // Only what is still empty is filled, so a tap never overwrites the seller.
  const copy = sameAs?.value;
  const { details } = current;
  const fill = {
    optionGroups: current.optionGroups.length === 0 ? copy?.optionGroups : undefined,
    facts: !details.materials.trim() && !details.origin.trim() && !details.care.trim() ? copy?.facts : undefined,
    safety: !isDigital && !safetyStarted(details.safety) ? copy?.safety : undefined,
  };
  const canCopy = Boolean(fill.optionGroups || fill.facts || fill.safety);

  function applySameAs() {
    const { optionGroups, facts, safety } = fill;
    const after: Starter = {
      optionGroups: optionGroups ? copyOptionGroups(optionGroups, mintId) : current.optionGroups,
      details: {
        ...details,
        ...(facts ? { materials: facts.materials ?? "", origin: facts.origin ?? "", care: facts.care ?? "" } : {}),
        ...(safety
          ? {
              safety: {
                ...details.safety,
                manufacturerName: safety.manufacturerName,
                manufacturerAddress: safety.manufacturerAddress,
                manufacturerEmail: safety.manufacturerEmail,
                responsibleName: safety.responsibleName ?? "",
                responsibleAddress: safety.responsibleAddress ?? "",
                responsibleEmail: safety.responsibleEmail ?? "",
              },
            }
          : {}),
      },
    };
    const open: ExtraSectionId[] = [
      ...(optionGroups ? (["options"] as const) : []),
      ...(facts ? (["specs"] as const) : []),
      ...(safety ? (["safety"] as const) : []),
    ];
    apply("sameAs", "", after, open);
  }

  const sizeName = t("presets.size.name");
  const sizes = guessSizes(title);
  const totalOptions = current.optionGroups.reduce((total, group) => total + group.options.length, 0);
  const canSize =
    sizes !== null &&
    current.optionGroups.length < OPTION_GROUPS_MAX &&
    totalOptions < OPTIONS_TOTAL_MAX &&
    !current.optionGroups.some((group) => group.name.trim().toLowerCase() === sizeName.toLowerCase());

  const sizesLabel =
    sizes && sizes.length > 0
      ? t("guessSizes", { first: sizes[0]!, last: sizes[sizes.length - 1]! })
      : t("guessSizesAny");
  const sizesHint = sizes && sizes.length > 0 ? t("guessSizesHint") : t("guessSizesAnyHint");

  function applySizes() {
    if (!sizes) return;
    const group = groupFromPreset(
      { name: sizeName, display: SIZE_PRESET.display, values: sizes.slice(0, OPTIONS_TOTAL_MAX - totalOptions) },
      mintId,
    );
    apply("sizes", sizesLabel, { ...current, optionGroups: [...current.optionGroups, group] }, ["options"]);
  }

  const showSameAs = sameAs && (done("sameAs") || canCopy);
  const showSizes = done("sizes") || canSize;
  if (!showSameAs && !showSizes) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" data-product-starters="">
      {showSameAs && (
        <SameAsChip
          from={sameAs.from}
          hint={t("sameAsHint", { title: sameAs.from })}
          done={done("sameAs")}
          onApply={applySameAs}
          onUndo={undo}
        />
      )}
      {showSizes && (
        <SuggestionChip
          icon={Plus}
          label={done("sizes") && applied ? applied.label : sizesLabel}
          hint={sizesHint}
          done={done("sizes")}
          onApply={applySizes}
          onUndo={undo}
        />
      )}
    </div>
  );
}
