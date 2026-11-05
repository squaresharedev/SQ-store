"use client";

import { useTranslations } from "next-intl";
import { SliderField } from "@/components/ui/SliderField";
import {
  TEXT_LETTER_SPACING_MAX,
  TEXT_LETTER_SPACING_MIN,
  TEXT_LINE_HEIGHT_DEFAULT,
  TEXT_LINE_HEIGHT_MAX,
  TEXT_LINE_HEIGHT_MIN,
  type TextBlock,
} from "@/types/storefront";

type Spacing = Pick<TextBlock, "letterSpacing" | "lineHeight">;

/** The line height slider's step: fine enough to set, coarse enough that a
 *  drag lands on round numbers, with the default (125) on the track. */
const LINE_HEIGHT_STEP = 5;

/**
 * A text block's spacing: how far apart the letters sit, and the lines. Both
 * read "Normal" where they rest, and dragging one back there stores nothing,
 * so a block the seller tried and put back is the block it was. Both are a
 * percent of the type size, which is how they keep their look when the size
 * changes or Auto shrinks the words to fit.
 */
export function TextSpacingFields({
  id,
  value,
  onChange,
  highlighted,
}: {
  id: string;
  value: Spacing;
  onChange: (patch: Spacing) => void;
  /** Lit by a summons (see SummonedField). */
  highlighted?: boolean;
}) {
  const t = useTranslations("Storefront.textSpacing");
  const letters = value.letterSpacing ?? 0;
  const lines = value.lineHeight ?? TEXT_LINE_HEIGHT_DEFAULT;
  return (
    <div className="space-y-4">
      <SliderField
        id={`${id}-letters`}
        label={t("letterSpacing")}
        min={TEXT_LETTER_SPACING_MIN}
        max={TEXT_LETTER_SPACING_MAX}
        value={letters}
        onChange={(next) => onChange({ letterSpacing: next === 0 ? undefined : next })}
        ariaLabel={t("letterSpacing")}
        valueText={letters === 0 ? t("normal") : t("valueText", { value: letters })}
        statusText={letters === 0 ? t("normal") : undefined}
        unit="%"
        highlighted={highlighted}
      />
      <SliderField
        id={`${id}-lines`}
        label={t("lineHeight")}
        min={TEXT_LINE_HEIGHT_MIN}
        max={TEXT_LINE_HEIGHT_MAX}
        step={LINE_HEIGHT_STEP}
        value={lines}
        onChange={(next) => onChange({ lineHeight: next === TEXT_LINE_HEIGHT_DEFAULT ? undefined : next })}
        ariaLabel={t("lineHeight")}
        valueText={lines === TEXT_LINE_HEIGHT_DEFAULT ? t("normal") : t("valueText", { value: lines })}
        statusText={lines === TEXT_LINE_HEIGHT_DEFAULT ? t("normal") : undefined}
        unit="%"
        highlighted={highlighted}
      />
    </div>
  );
}
