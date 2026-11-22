"use client";

import { MoveHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { secondaryButtonClass } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";
import { BLOCK_KIND_LABELS } from "./block-label";

/**
 * "Scrolling text" in the library's Shapes tab, after the shapes: the way a
 * strip gets onto the board. The words it starts with are resolved here, once,
 * in the seller's language: saved, they are the seller's own words.
 */
export function MarqueeLibraryEntry({
  onAdd,
  disabled,
}: {
  onAdd: (text: string) => void;
  /** At the block cap: the button disables rather than fails silently. */
  disabled: boolean;
}) {
  const t = useTranslations("EditorFinish.panel.marquee");
  const tRoot = useTranslations();
  return (
    <CollapsibleSection title={tRoot(BLOCK_KIND_LABELS.marquee)}>
      <button
        type="button"
        onClick={() => onAdd(t("defaultText"))}
        disabled={disabled}
        className={cn(secondaryButtonClass, "w-full disabled:pointer-events-none disabled:opacity-50")}
      >
        <MoveHorizontal className="size-4" strokeWidth={2} aria-hidden="true" />
        {t("add")}
      </button>
    </CollapsibleSection>
  );
}
