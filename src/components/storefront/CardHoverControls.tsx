"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { InfoTip } from "@/components/ui/InfoTip";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { strongLabelClass } from "@/components/ui/control-styles";
import { CARD_HOVER_EFFECTS, type CardStyle, type CardStyleOverrides } from "@/types/storefront";
import { SwitchRow } from "./SwitchRow";

/**
 * WHAT A CARD DOES WHEN A BUYER POINTS AT IT: one choice of effect (none,
 * lift, zoom, tilt), and whether the product's second photo shows. The same
 * component edits the theme's cards and one tile's own, like CardStyleControls,
 * and emits only the field it changed.
 */
export function CardHoverControls({
  value,
  onChange,
}: {
  value: CardStyle;
  onChange: (patch: CardStyleOverrides) => void;
}) {
  const t = useTranslations("Storefront.cardExtras");
  const fieldId = useId();
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <span className="flex items-center gap-1.5">
          <span className={strongLabelClass}>{t("effect")}</span>
          <InfoTip label={t("effectTipLabel")}>{t("effectTip")}</InfoTip>
        </span>
        <SegmentedControl
          value={value.hoverEffect}
          onChange={(hoverEffect) => onChange({ hoverEffect })}
          ariaLabel={t("effectAriaLabel")}
          options={CARD_HOVER_EFFECTS.map((effect) => ({ value: effect, label: t(`effects.${effect}`) }))}
        />
      </div>
      <SwitchRow
        id={`${fieldId}-second-photo`}
        label={t("secondPhoto")}
        checked={value.hoverPhoto}
        onCheckedChange={(hoverPhoto) => onChange({ hoverPhoto })}
        tipLabel={t("secondPhotoTipLabel")}
        tip={t("secondPhotoTip")}
      />
    </div>
  );
}
