"use client";

import { useId } from "react";
import type { StorefrontTheme } from "@/types/storefront";
import { Switch } from "@/components/ui/switch";
import { infoTextClass, labelClass } from "@/components/ui/control-styles";

/**
 * What happens to a product once the seller marks it sold out.
 *
 * Replaces the old "Advanced" section, which held one of these two switches
 * while the other sat under "Cards". They are the same decision taken twice:
 * whether the product still appears, and if it does, whether it is labelled. A
 * seller who wanted "stop showing this" had to find a section called Advanced
 * to do it, and a section named for its difficulty rather than its subject
 * cannot be searched for or reasoned about.
 *
 * The order matters: hiding wins over badging, so the badge switch reads as
 * dead when the product is not shown at all. Saying so is cheaper than
 * disabling it, which would leave no room to explain why.
 */
export function SoldOutSection({
  theme,
  onChange,
}: {
  theme: StorefrontTheme;
  onChange: (theme: StorefrontTheme) => void;
}) {
  const fieldId = useId();

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={`${fieldId}-hide`} className={labelClass}>
            Hide from buyers
          </label>
          <Switch
            id={`${fieldId}-hide`}
            checked={theme.hideSoldOut}
            onCheckedChange={(hideSoldOut) => onChange({ ...theme, hideSoldOut })}
          />
        </div>
        <p className={infoTextClass}>
          Buyers won&apos;t see products you marked sold out. In the editor they
          stay visible but dimmed.
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={`${fieldId}-badge`} className={labelClass}>
            Show badge
          </label>
          <Switch
            id={`${fieldId}-badge`}
            checked={theme.soldOutBadge}
            onCheckedChange={(soldOutBadge) =>
              onChange({ ...theme, soldOutBadge })
            }
          />
        </div>
        <p className={infoTextClass}>
          {theme.hideSoldOut
            ? "Only applies while sold-out products are shown."
            : "Marks sold-out products on the storefront."}
        </p>
      </div>
    </div>
  );
}
