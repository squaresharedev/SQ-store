"use client";

import { useId } from "react";
import type { StorefrontTheme } from "@/types/storefront";
import { Switch } from "@/components/ui/switch";
import { helpTextClass, labelClass } from "@/components/ui/control-styles";

/**
 * AdvancedSection — power-user display rules. (Store header/bio graduated to
 * HeaderSection; block spacing merged into the Layout section's density.)
 */
export function AdvancedSection({
  theme,
  onChange,
}: {
  theme: StorefrontTheme;
  onChange: (theme: StorefrontTheme) => void;
}) {
  const fieldId = useId();

  return (
    <div className="space-y-4">
      {/* Drops sold-out-marked blocks from the buyer view; the designer keeps
          showing them dimmed so they stay manageable. */}
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={`${fieldId}-hide-sold-out`} className={labelClass}>
          Hide sold-out products
        </label>
        <Switch
          id={`${fieldId}-hide-sold-out`}
          checked={theme.hideSoldOut}
          onCheckedChange={(hideSoldOut) => onChange({ ...theme, hideSoldOut })}
        />
      </div>
      <p className={helpTextClass}>
        Buyers won&apos;t see products you marked sold out. In the editor they
        stay visible but dimmed.
      </p>
    </div>
  );
}
