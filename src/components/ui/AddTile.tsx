import type { LucideIcon } from "lucide-react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  focusRingClass,
  hoverLiftClass,
  iconPopClass,
  transitionClass,
} from "@/components/ui/control-styles";
import { CutoffGlyph, cutoffGlyphGroupClass } from "@/components/ui/CutoffGlyph";

/**
 * ONE THING TO ADD, AS A TILE: its name and a one-line hint at the top, a big
 * glyph cut off by the corner, and a square plus that fills with ink as the
 * tile lifts. For a short menu of optional additions (a product's extras, a
 * shipping destination), where a row of "Add …" buttons would all look alike.
 * Extra attributes (data-*, aria-*) land on the button.
 */
export function AddTile({
  icon,
  label,
  hint,
  onClick,
  className,
  ...attributes
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
  onClick: () => void;
  className?: string;
} & Record<`data-${string}` | `aria-${string}`, string | undefined>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        cutoffGlyphGroupClass,
        "group/btn flex min-h-28 size-full flex-col items-start justify-between gap-4 border border-border bg-background p-3 text-left hover:border-foreground/40",
        hoverLiftClass,
        focusRingClass,
        className,
      )}
      {...attributes}
    >
      <CutoffGlyph icon={icon} />
      <span className="flex flex-col gap-0.5 pr-6">
        <span className="text-sm font-semibold text-foreground">{label}</span>
        <span className="font-inter text-xs text-muted-foreground">{hint}</span>
      </span>
      <span
        className={cn(
          "grid size-7 place-items-center border border-border bg-background text-foreground",
          "group-hover/btn:border-foreground group-hover/btn:bg-foreground group-hover/btn:text-background",
          transitionClass,
        )}
      >
        <Plus className={cn("size-4", iconPopClass)} strokeWidth={2} aria-hidden="true" />
      </span>
    </button>
  );
}
