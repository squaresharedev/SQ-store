"use client";

import { useId } from "react";
import { Trash2 } from "lucide-react";
import { SHAPE_KINDS, type ShapeBlock, type ShapeKind } from "@/types/storefront";
import { destructiveButtonClass, labelClass } from "@/components/ui/control-styles";
import { Select, type SelectOption } from "@/components/ui/select";
import { ColorPicker } from "@/components/ui/ColorPicker";

export type ShapeBlockPatch = Partial<Pick<ShapeBlock, "kind" | "color">>;

/** Human-readable label for each shape kind. */
const SHAPE_KIND_LABELS: Record<ShapeKind, string> = {
  square: "Square",
  circle: "Circle",
  ring: "Ring",
  diamond: "Diamond",
  spacer: "Spacer",
};

const SHAPE_KIND_OPTIONS: readonly SelectOption<ShapeKind>[] = SHAPE_KINDS.map(
  (kind) => ({
    value: kind,
    label: SHAPE_KIND_LABELS[kind],
    description:
      kind === "spacer" ? "Empty space to shape your layout" : undefined,
  }),
);

/**
 * Inspector card body for a SHAPE block in the side panel. Lets the seller
 * switch the shape kind and pick a fill color (hidden for spacers, which have
 * no visual fill). Patches emit on each change; no "save" step.
 */
export function ShapeBlockEditor({
  block,
  onUpdate,
  onRemove,
}: {
  block: ShapeBlock;
  onUpdate: (patch: ShapeBlockPatch) => void;
  onRemove: () => void;
}) {
  const fieldId = useId();

  return (
    <div className="space-y-4">
      {/* Shape kind selector */}
      <div className="space-y-1.5">
        <label htmlFor={`${fieldId}-kind`} className={labelClass}>
          Shape
        </label>
        <Select
          id={`${fieldId}-kind`}
          value={block.kind}
          options={SHAPE_KIND_OPTIONS}
          onChange={(kind) => onUpdate({ kind })}
        />
      </div>

      {/* Fill color — hidden entirely for spacers (no visual fill) */}
      {block.kind !== "spacer" && (
        <ColorPicker
          id={`${fieldId}-color`}
          label="Fill"
          value={block.color}
          onChange={(color) => onUpdate({ color })}
        />
      )}

      {/* Remove action */}
      <button
        type="button"
        onClick={onRemove}
        className={destructiveButtonClass + " w-full"}
      >
        <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
        Remove from grid
      </button>
    </div>
  );
}
