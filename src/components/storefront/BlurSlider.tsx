"use client";

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { BLUR_DIRECTIONS, BLUR_MAX, type BlurDirection } from "@/types/storefront";
import { infoTextClass, labelClass } from "@/components/ui/control-styles";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SliderField } from "@/components/ui/SliderField";

/**
 * What each direction looks like, drawn rather than named: a small square
 * shaded where the blur is, in the button's own ink, so the chosen one turns
 * white on black like any other segment.
 */
const DIRECTION_GLYPHS: Record<BlurDirection, CSSProperties> = {
  all: { backgroundColor: "currentColor", opacity: 0.55 },
  top: { backgroundImage: "linear-gradient(to bottom, currentColor, transparent)" },
  bottom: { backgroundImage: "linear-gradient(to top, currentColor, transparent)" },
  left: { backgroundImage: "linear-gradient(to right, currentColor, transparent)" },
  right: { backgroundImage: "linear-gradient(to left, currentColor, transparent)" },
};

/**
 * THE ONE BLUR CONTROL, wherever something on the board can be blurred: a
 * shape, an element, a text block, a product's photo, the shadow fade. Same
 * range, same steps, same words everywhere, so a seller who has learned it
 * once has learned all of them. 0 reads "Off" rather than a number, because
 * sharp is what nearly everything is and the word says so at a glance.
 *
 * WHICH WAY IT RUNS comes second, and only once there is a blur to steer: a
 * row of five pictures (all over, or soft from one edge) with the chosen one
 * named beside its label. A seller who never moves the slider never sees it.
 * Absent `onDirectionChange` = a blur with no direction to choose (the shadow
 * fade, whose frost runs with the fade).
 */
export function BlurSlider({
  id,
  label,
  value,
  onChange,
  direction,
  onDirectionChange,
  tip,
  labelClassName,
  highlighted,
}: {
  id: string;
  /** Absent = plain "Blur", for a block that has only the one. */
  label?: string;
  value: number;
  onChange: (value: number) => void;
  direction?: BlurDirection;
  onDirectionChange?: (direction: BlurDirection) => void;
  tip?: string;
  labelClassName?: string;
  /** Lit by a toolbar summons (see SummonedField). */
  highlighted?: boolean;
}) {
  const t = useTranslations("Storefront.blur");
  const name = label ?? t("label");
  const runs = direction ?? "all";
  return (
    <div className="space-y-3">
      <SliderField
        id={id}
        label={name}
        min={0}
        max={BLUR_MAX}
        step={5}
        value={value}
        onChange={onChange}
        ariaLabel={name}
        valueText={value === 0 ? t("off") : t("valueText", { value })}
        statusText={value === 0 ? t("off") : undefined}
        tip={tip}
        labelClassName={labelClassName}
        highlighted={highlighted}
      />
      {onDirectionChange && value > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className={labelClass}>{t("direction")}</span>
            <span className={infoTextClass}>{t(`directions.${runs}`)}</span>
          </div>
          <SegmentedControl
            value={runs}
            onChange={onDirectionChange}
            ariaLabel={t("directionAriaLabel")}
            options={BLUR_DIRECTIONS.map((option) => ({
              value: option,
              label: (
                <>
                  <span
                    aria-hidden="true"
                    className="size-3.5 border border-current"
                    style={DIRECTION_GLYPHS[option]}
                  />
                  <span className="sr-only">{t(`directions.${option}`)}</span>
                </>
              ),
            }))}
          />
        </div>
      )}
    </div>
  );
}
