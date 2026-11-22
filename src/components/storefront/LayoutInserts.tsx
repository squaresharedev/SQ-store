"use client";

import { MousePointerClick, Rows3 } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { focusRingClass, transitionClass } from "@/components/ui/control-styles";

/**
 * The library's "Layout" group: a full-width band and a button. Shown at the
 * top of the shape library (ShapesPanel), as the same square buttons, so the
 * two are found where everything else that goes on the board is.
 */
export function LayoutInserts({
  onAddBand,
  onAddButton,
  canAddBlocks,
}: {
  onAddBand: () => void;
  onAddButton: () => void;
  /** False at the block cap: a button is a block, a band is not. */
  canAddBlocks: boolean;
}) {
  const t = useTranslations("EditorLayout.panel.insert");
  const items = [
    { id: "band", icon: Rows3, onClick: onAddBand, disabled: false },
    { id: "button", icon: MousePointerClick, onClick: onAddButton, disabled: !canAddBlocks },
  ] as const;
  return (
    <CollapsibleSection title={t("group")}>
      <div role="group" aria-label={t("groupLabel")} className="grid grid-cols-2 gap-1.5" data-layout-inserts="">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={item.onClick}
            disabled={item.disabled}
            aria-label={t(`add.${item.id}`)}
            data-layout-insert={item.id}
            className={cn(
              "inline-flex h-16 w-full flex-col items-center justify-center gap-1 rounded-sm border border-border font-inter text-xs",
              "text-foreground hover:border-foreground hover:bg-accent",
              "disabled:pointer-events-none disabled:opacity-50",
              transitionClass,
              focusRingClass,
            )}
          >
            <item.icon className="size-5" strokeWidth={2} aria-hidden="true" />
            <span aria-hidden="true">{t(`name.${item.id}`)}</span>
          </button>
        ))}
      </div>
    </CollapsibleSection>
  );
}
