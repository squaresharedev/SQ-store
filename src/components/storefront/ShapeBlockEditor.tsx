"use client";

import { useId } from "react";
import {
  RING_DEFAULT_WIDTH,
  SHAPE_BORDER_WIDTH_MAX,
  SHAPE_KINDS,
  SHAPE_POINTS_MAX,
  SHAPE_POINTS_MIN,
  SHAPE_ROUNDNESS_MAX,
  blockKey,
  type ShapeBlock,
} from "@/types/storefront";
import { DEFAULT_SHAPE_BORDER_COLOR } from "@/lib/theme/color-target";
import { cn } from "@/lib/utils";
import {
  focusRingClass,
  labelClass,
  transitionClass,
} from "@/components/ui/control-styles";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { SliderField } from "@/components/ui/SliderField";
import { BlockActions } from "./BlockActions";
import { SummonedField, type BlockFieldSummons } from "./SummonedField";
import { ShapeKindGlyph } from "./ShapeTileContent";
import { SHAPE_SPECS } from "./shape-specs";
import {
  STAR_DEFAULTS,
  defaultRoundness,
  supportsPoints,
  supportsRoundness,
} from "./shape-geometry";

export type ShapeBlockPatch = Partial<
  Pick<
    ShapeBlock,
    | "kind"
    | "color"
    | "borderWidth"
    | "borderColor"
    | "opacity"
    | "roundness"
    | "points"
  >
>;

/** First border color when the seller turns an outline on. Shared with the
 *  ColorPanel (lib/theme/color-target) so the field and the panel cannot
 *  disagree about what "no border color set" looks like. */
const DEFAULT_BORDER_COLOR = DEFAULT_SHAPE_BORDER_COLOR;

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
  onDuplicate,
  onRemove,
  removeLabel,
  summons = null,
}: {
  block: ShapeBlock;
  onUpdate: (patch: ShapeBlockPatch) => void;
  /** Insert a copy of this block (the no-keyboard copy/paste path). */
  onDuplicate: () => void;
  onRemove: () => void;
  /** Overridden when this editor is driving a whole multi-selection, where the
   *  honest word is "Remove 3 blocks". */
  removeLabel?: string;
  /** A control the selection toolbar has pointed at: scrolled to and marked
   *  here rather than duplicated in a popover over the block itself. */
  summons?: BlockFieldSummons;
}) {
  const fieldId = useId();
  const isRing = block.kind === "ring";
  const borderWidth =
    block.borderWidth ?? (isRing ? RING_DEFAULT_WIDTH : 0);
  const opacity = block.opacity ?? 100;
  const roundness = block.roundness ?? defaultRoundness(block.kind);
  const points = block.points ?? STAR_DEFAULTS[block.kind]?.points ?? 5;

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

      {/* Point count, on the star-family kinds only. */}
      {supportsPoints(block.kind) && (
        <SliderField
          id={`${fieldId}-points`}
          label="Points"
          min={SHAPE_POINTS_MIN}
          max={SHAPE_POINTS_MAX}
          value={points}
          onChange={(next) => onUpdate({ points: next })}
          ariaLabel="Star points"
          valueText={`${points} points`}
        />
      )}

      {/* Corner roundness, on the kinds whose corners are not already fixed
          by construction (circle, pill, ... stay as they are). */}
      {supportsRoundness(block.kind) && (
        <SummonedField field="corners" summons={summons} variant="slider">
          {(highlighted) => (
            <SliderField
              id={`${fieldId}-roundness`}
              label="Corner roundness"
              min={0}
              max={SHAPE_ROUNDNESS_MAX}
              step={2}
              value={roundness}
              onChange={(next) => onUpdate({ roundness: next })}
              ariaLabel="Corner roundness"
              valueText={`${roundness} percent`}
              statusText={roundness === 0 ? "Sharp" : undefined}
              unit="%"
              highlighted={highlighted}
            />
          )}
        </SummonedField>
      )}

      <SummonedField field="fill" summons={summons}>
        <ColorPicker
          id={`${fieldId}-fill`}
          label={isRing ? "Color" : "Fill"}
          value={block.color}
          onChange={(color) => onUpdate({ color })}
          target={{ kind: "shape-fill", blockKey: blockKey(block) }}
        />
      </SummonedField>

      {/* Outline: on a ring this is the ring's own thickness. Width and colour
          are ONE summons: they describe a single edge, and a seller who asked
          for "stroke" wants both in view — but only the width slider lights
          up, the colour swatch below it is scrolled into view unmarked. */}
      <SummonedField field="stroke" summons={summons} variant="slider">
        {(highlighted) => (
          <>
            <SliderField
              id={`${fieldId}-border-width`}
              label={isRing ? "Ring thickness" : "Border thickness"}
              min={isRing ? 1 : 0}
              max={SHAPE_BORDER_WIDTH_MAX}
              value={borderWidth}
              onChange={setBorderWidth}
              ariaLabel={isRing ? "Ring thickness" : "Border thickness"}
              valueText={`${borderWidth} pixels`}
              statusText={!isRing && borderWidth === 0 ? "None" : undefined}
              unit="px"
              highlighted={highlighted}
            />

            {/* Border color only matters on the filled kinds with an outline on. */}
            {!isRing && borderWidth > 0 && (
              <div className="mt-4">
                <ColorPicker
                  id={`${fieldId}-border-color`}
                  label="Border color"
                  value={block.borderColor ?? DEFAULT_BORDER_COLOR}
                  onChange={(borderColor) => onUpdate({ borderColor })}
                  target={{ kind: "shape-border", blockKey: blockKey(block) }}
                />
              </div>
            )}
          </>
        )}
      </SummonedField>

      <SummonedField field="opacity" summons={summons} variant="slider">
        {(highlighted) => (
          <SliderField
            id={`${fieldId}-opacity`}
            label="Opacity"
            min={0}
            max={100}
            step={5}
            value={opacity}
            onChange={(next) => onUpdate({ opacity: next })}
            ariaLabel="Shape opacity"
            valueText={`${opacity} percent`}
            unit="%"
            highlighted={highlighted}
          />
        )}
      </SummonedField>

      <BlockActions
        onDuplicate={onDuplicate}
        onRemove={onRemove}
        removeLabel={removeLabel}
      />
    </div>
  );
}
