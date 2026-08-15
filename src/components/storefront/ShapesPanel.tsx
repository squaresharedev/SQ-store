"use client";

import { cn } from "@/lib/utils";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { focusRingClass, transitionClass } from "@/components/ui/control-styles";
import type { ShapeKind } from "@/types/storefront";
import { ShapeKindGlyph } from "./ShapeTileContent";
import { SHAPE_GROUPS, SHAPE_SPECS } from "./shape-specs";

/**
 * The shape library, the second half of the left-hand library panel.
 *
 * WHY IT LIVES HERE NOW. It used to be a horizontal strip inside the toolbar's
 * hover menu, and 22 shapes never fitted: the strip scrolled sideways, so
 * everything past the first handful went unseen. Docked, the whole library is
 * visible at once, grouped, and the canvas stays in view while you pick — the
 * same argument that put the color panel here. The toolbar keeps only the two
 * shapes nobody should open a panel for (QUICK_SHAPE_KINDS).
 *
 * Picking a shape does NOT close the panel: adding three shapes should be
 * three clicks, not three round trips through the toolbar.
 */
export function ShapesPanel({
  onAddShape,
  canAddBlocks,
}: {
  onAddShape: (kind: ShapeKind) => void;
  /** False at the block cap; the buttons disable rather than fail silently. */
  canAddBlocks: boolean;
}) {
  return (
    <div>
      {SHAPE_GROUPS.map((group) => (
        <CollapsibleSection key={group.title} title={group.title}>
          <div
            role="group"
            aria-label={`${group.title} shapes`}
            className="grid grid-cols-4 gap-1.5"
          >
            {group.kinds.map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => onAddShape(kind)}
                disabled={!canAddBlocks}
                aria-label={`Add ${SHAPE_SPECS[kind].label.toLowerCase()}`}
                title={SHAPE_SPECS[kind].label}
                className={cn(
                  "inline-flex aspect-square w-full items-center justify-center rounded-sm border border-border",
                  "text-foreground hover:border-foreground hover:bg-accent",
                  "disabled:pointer-events-none disabled:opacity-50",
                  transitionClass,
                  focusRingClass,
                )}
              >
                <ShapeKindGlyph kind={kind} />
              </button>
            ))}
          </div>
        </CollapsibleSection>
      ))}
    </div>
  );
}
