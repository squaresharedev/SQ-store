"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  MOTION_PRESETS,
  TEXTURES,
  type MotionPreset,
  type StorefrontTheme,
  type Texture,
} from "@/types/storefront";
import { withMotion } from "@/lib/storefront/motion";
import { withTexture } from "@/lib/storefront/texture";
import { infoTextClass, labelClass } from "@/components/ui/control-styles";
import { Disclosure } from "@/components/ui/Disclosure";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

/**
 * MOTION AND FINISH, for the whole storefront: how the board arrives on a
 * buyer's screen, and (behind "More") a paper grain over its background. Sits
 * under the Theme essentials (ControlsPanel): one visible control.
 *
 * The designer's canvas never moves (the motion plays on buyers' pages only),
 * so picking a preset plays it once on the little preview beside the hint:
 * without it, choosing "Lively" would look like it did nothing. The grain is
 * drawn on the canvas too, so it needs no preview.
 */
export function FinishControls({
  theme,
  onChange,
}: {
  theme: StorefrontTheme;
  onChange: (theme: StorefrontTheme) => void;
}) {
  const t = useTranslations("EditorFinish.panel");
  const motion = theme.motion ?? "none";
  const texture = theme.texture ?? "none";
  // Bumped on every pick, so choosing the same preset again replays it.
  const [plays, setPlays] = useState(0);
  // "More" opens with the panel when it holds a choice the seller made.
  const [moreOpen] = useState(texture !== "none");

  return (
    <div className="mt-4 space-y-4">
      <div className="space-y-1.5">
        <span className={labelClass}>{t("motion.label")}</span>
        <SegmentedControl
          value={motion}
          options={MOTION_PRESETS.map((value) => ({ value, label: t(`motion.${value}`) }))}
          onChange={(next: MotionPreset) => {
            onChange(withMotion(theme, next));
            setPlays((count) => count + 1);
          }}
          ariaLabel={t("motion.label")}
        />
        <div className="flex items-center gap-2">
          <MotionPreview key={`${motion}-${plays}`} preset={motion} />
          <p className={infoTextClass}>{t("motion.hint")}</p>
        </div>
      </div>
      <Disclosure open={moreOpen} summary={<span className={labelClass}>{t("more")}</span>}>
        <div className="space-y-1.5">
          <span className={labelClass}>{t("texture.label")}</span>
          <SegmentedControl
            value={texture}
            options={TEXTURES.map((value) => ({ value, label: t(`texture.${value}`) }))}
            onChange={(next: Texture) => onChange(withTexture(theme, next))}
            ariaLabel={t("texture.label")}
          />
          <p className={infoTextClass}>{t("texture.hint")}</p>
        </div>
      </Disclosure>
    </div>
  );
}

/**
 * Three small blocks playing the board's own arrival (the same keyframes, see
 * globals.css): once per pick, never under reduced motion, and still for
 * `none`. Decoration only, so it is hidden from assistive tech.
 */
function MotionPreview({ preset }: { preset: MotionPreset }) {
  return (
    <span aria-hidden="true" className="board-motion-preview flex shrink-0 gap-1" data-preset={preset}>
      {[0, 1, 2].map((index) => (
        <span key={index} className="size-2.5 rounded-xs bg-foreground/60" />
      ))}
    </span>
  );
}
