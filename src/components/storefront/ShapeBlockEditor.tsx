"use client";

import { Trash2 } from "lucide-react";
import {
  RING_DEFAULT_WIDTH,
  SHAPE_BORDER_WIDTH_MAX,
  SHAPE_KINDS,
  type ShapeBlock,
} from "@/types/storefront";
import { cn } from "@/lib/utils";
import {
  destructiveButtonClass,
  focusRingClass,
  infoTextClass,
  labelClass,
  transitionClass,
} from "@/components/ui/control-styles";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { Slider } from "@/components/ui/slider";
import { ShapeKindGlyph } from "./ShapeTileContent";
import { SHAPE_SPECS } from "./shape-specs";

export type ShapeBlockPatch = Partial<
  Pick<ShapeBlock, "kind" | "color" | "borderWidth" | "borderColor" | "opacity">
>;

/** First border color when the seller turns an outline on. */
const DEFAULT_BORDER_COLOR = "#171717";

const KIND_BUTTON_CLASS = `inline-flex size-9 items-center justify-center rounded-none border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground ${transitionClass} ${focusRingClass}`;

/**
 * Inspector card body for a SHAPE block in the side panel: the kind picker
 * (the shapes themselves, no dropdown), color, opacity, and outline controls.
 * A `ring` has no fill, so there its color IS the stroke and the width slider
 * sets the ring's thickness. Patches emit on each change; no "save" step.
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
  const isRing = block.kind === "ring";
  const borderWidth =
    block.borderWidth ?? (isRing ? RING_DEFAULT_WIDTH : 0);
  const opacity = block.opacity ?? 100;

  function setBorderWidth(width: number) {
    // Turning an outline on for the first time also needs a visible color.
    const needsColor = !isRing && width > 0 && block.borderColor === undefined;
    onUpdate(
      needsColor
        ? { borderWidth: width, borderColor: DEFAULT_BORDER_COLOR }
        : { borderWidth: width },
    );
  }

  return (
    <div className="space-y-4">
      {/* Shape kind: the shapes themselves, wrapping to fill the panel width
          (too many to fit one row), current one highlighted. */}
      <div className="space-y-1.5">
        <span className={labelClass}>Shape</span>
        <div role="group" aria-label="Shape kind" className="flex flex-wrap gap-1">
          {SHAPE_KINDS.map((kind) => {
            const selected = block.kind === kind;
            const label = SHAPE_SPECS[kind].label;
            return (
              <button
                key={kind}
                type="button"
                onClick={() => onUpdate({ kind })}
                aria-label={label}
                aria-pressed={selected}
                title={label}
                className={cn(
                  KIND_BUTTON_CLASS,
                  selected && "border-foreground bg-accent text-foreground",
                )}
              >
                <ShapeKindGlyph kind={kind} />
              </button>
            );
          })}
        </div>
      </div>

      <ColorPicker
        id="shape-fill"
        label={isRing ? "Color" : "Fill"}
        value={block.color}
        onChange={(color) => onUpdate({ color })}
      />

      {/* Outline: on a ring this is the ring's own thickness. */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className={labelClass}>
            {isRing ? "Ring thickness" : "Border thickness"}
          </span>
          <span className={infoTextClass}>
            {borderWidth === 0 ? "None" : `${borderWidth}px`}
          </span>
        </div>
        <Slider
          min={isRing ? 1 : 0}
          max={SHAPE_BORDER_WIDTH_MAX}
          value={borderWidth}
          onChange={setBorderWidth}
          ariaLabel={isRing ? "Ring thickness" : "Border thickness"}
          valueText={`${borderWidth} pixels`}
        />
      </div>

      {/* Border color only matters on the filled kinds with an outline on. */}
      {!isRing && borderWidth > 0 && (
        <ColorPicker
          id="shape-border-color"
          label="Border color"
          value={block.borderColor ?? DEFAULT_BORDER_COLOR}
          onChange={(borderColor) => onUpdate({ borderColor })}
        />
      )}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className={labelClass}>Opacity</span>
          <span className={infoTextClass}>{opacity}%</span>
        </div>
        <Slider
          min={0}
          max={100}
          step={5}
          value={opacity}
          onChange={(next) => onUpdate({ opacity: next })}
          ariaLabel="Shape opacity"
          valueText={`${opacity} percent`}
        />
      </div>

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
