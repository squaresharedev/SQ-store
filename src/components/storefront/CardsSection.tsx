"use client";

import { useId } from "react";
import {
  resolveCardStyle,
  type CardStyleOverrides,
  type StorefrontTheme,
} from "@/types/storefront";
import { Switch } from "@/components/ui/switch";
import { strongLabelClass } from "@/components/ui/control-styles";
import { CardStyleControls } from "./CardStyleControls";

/**
 * Card appearance for the whole theme: the shared CardStyleControls working
 * on the theme's own card fields (the same component each product tile's
 * inspector uses on its overrides), plus the sold-out badge, which is
 * theme-only. A patch from the controls spreads straight into the theme.
 */
export function CardsSection({
  theme,
  onChange,
}: {
  theme: StorefrontTheme;
  onChange: (theme: StorefrontTheme) => void;
}) {
  const fieldId = useId();

  function applyPatch(patch: CardStyleOverrides) {
    onChange({ ...theme, ...patch });
  }

  return (
    <div className="space-y-4">
      <CardStyleControls value={resolveCardStyle(theme)} onChange={applyPatch} />

      {/* Shows the badge on blocks the seller marked sold out (the tag toggle
          on each product tile). */}
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={`${fieldId}-sold-out-badge`} className={strongLabelClass}>
          Sold-out badge
        </label>
        <Switch
          id={`${fieldId}-sold-out-badge`}
          checked={theme.soldOutBadge}
          onCheckedChange={(soldOutBadge) =>
            onChange({ ...theme, soldOutBadge })
          }
        />
      </div>
    </div>
  );
}
