"use client";

import { useId } from "react";
import {
  BringToFront,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Layers,
  SendToBack,
} from "lucide-react";
import {
  ROTATION_MAX,
  ROTATION_MIN,
  blockKey,
  blocksOverlap,
  layerOrder,
  type StorefrontBlock,
} from "@/types/storefront";
import type { LayerOp } from "@/lib/storefront/layers";
import { cn } from "@/lib/utils";
import {
  helpTextClass,
  infoTextClass,
  labelClass,
  transitionClass,
  focusRingClass,
} from "@/components/ui/control-styles";
import { SliderField } from "@/components/ui/SliderField";
import { InfoTip } from "@/components/ui/InfoTip";

/**
 * How the selected block(s) SIT on the canvas, as opposed to what they are
 * made of: the tilt and the depth today, and the place free positioning lands
 * next.
 *
 * Its own section rather than a row inside each of the four block editors,
 * because placement is the one thing every kind of block has in common. A
 * mixed selection has no shared fill or typeface, but it always has an angle
 * and a place in the stack.
 */

/** The angle every block in the selection shares, or null when they disagree.
 *  A mixed selection must not show one block's value as if it were the
 *  group's: the next drag of the slider would flatten the others onto it
 *  without ever having said so. */
function sharedRotation(blocks: readonly StorefrontBlock[]): number | null {
  if (blocks.length === 0) return null;
  const first = blocks[0].rotation ?? 0;
  return blocks.every((block) => (block.rotation ?? 0) === first) ? first : null;
}

/**
 * Where the selection sits in the board's paint order, and which way it can
 * still travel.
 *
 * Both ends are ONE question: a selection that already occupies the topmost
 * run cannot be brought forward and cannot be brought to front either, since
 * "to front" would land it exactly where it is. Reading it off the resolved
 * order rather than off the z values means an unlayered board answers just as
 * well as a layered one.
 */
function layerState(
  board: readonly StorefrontBlock[],
  selection: readonly StorefrontBlock[],
): {
  index: number | null;
  total: number;
  atFront: boolean;
  atBack: boolean;
  stacked: boolean;
} {
  const order = layerOrder([...board]);
  const keys = new Set(selection.map(blockKey));
  const spots = order
    .map((block, index) => (keys.has(blockKey(block)) ? index : -1))
    .filter((index) => index >= 0);
  return {
    index: spots.length === 1 ? spots[0] : null,
    total: order.length,
    // An empty or unfound selection has nowhere to go, which reads as both
    // ends at once and leaves every control disabled.
    atFront: spots.every((spot, i) => spot === order.length - spots.length + i),
    atBack: spots.every((spot, i) => spot === i),
    // Whether these controls are doing anything visible yet: depth only shows
    // where two blocks share cells, so the hint about reaching underneath is
    // worth its line exactly then.
    stacked: board.some(
      (other) =>
        !keys.has(blockKey(other)) &&
        selection.some((block) => blocksOverlap(block, other)),
    ),
  };
}

/** The four moves, back to front left to right, so the row reads like the
 *  stack it edits. `end` names which end of that stack disables the control.
 *
 *  Exported because the layers list wears the same four controls per row: two
 *  copies of this table is how the panel and the list end up disagreeing about
 *  what "backward" is called. */
export const LAYER_CONTROLS = [
  { op: "back", label: "Send to back", icon: SendToBack, end: "back" },
  { op: "backward", label: "Send backward", icon: ChevronDown, end: "back" },
  { op: "forward", label: "Bring forward", icon: ChevronUp, end: "front" },
  { op: "front", label: "Bring to front", icon: BringToFront, end: "front" },
] as const satisfies readonly {
  op: LayerOp;
  label: string;
  icon: typeof SendToBack;
  end: "front" | "back";
}[];

/** Icon-row chrome, matching the format/alignment toggles this panel already
 *  wears (TextFormatControls). Shared with the layers list for the same reason
 *  {@link LAYER_CONTROLS} is. */
export const LAYER_BUTTON_CLASS = cn(
  "inline-flex size-8 items-center justify-center rounded-none border border-border",
  "bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
  "disabled:pointer-events-none disabled:opacity-50",
  transitionClass,
  focusRingClass,
);

/** The way through to the whole stack. A full-width row rather than a fifth
 *  icon: it navigates instead of moving anything, and putting it in the icon
 *  row would make one of five buttons behave unlike the other four. */
const SEE_LAYERS_CLASS = cn(
  "flex min-h-9 w-full items-center justify-between gap-2 rounded-none border border-border",
  "bg-background px-2.5 py-1.5 font-inter text-sm text-foreground",
  "hover:bg-accent",
  transitionClass,
  focusRingClass,
);

const QUICK_ANGLES = [-90, 0, 90] as const;

const QUICK_BUTTON_CLASS = cn(
  "inline-flex h-8 flex-1 items-center justify-center rounded-none border border-border bg-background",
  "font-inter text-xs text-muted-foreground hover:bg-accent hover:text-foreground",
  transitionClass,
  focusRingClass,
);

export function PlacementSection({
  blocks,
  board,
  onRotate,
  onReorder,
  onOpenLayers,
}: {
  /** The current selection, in selection order (length >= 1). */
  blocks: readonly StorefrontBlock[];
  /** Every block on the board, which is what depth is relative to: "layer 3
   *  of 12" and "already at the front" are facts about the stack, not about
   *  the selection. */
  board: readonly StorefrontBlock[];
  /** Applies to the WHOLE selection, as one undo step. */
  onRotate: (degrees: number) => void;
  /** Moves the WHOLE selection through the stack, keeping its own relative
   *  order, as one undo step per press. */
  onReorder: (op: LayerOp) => void;
  /** Swaps this panel over to the full stack. Omitted where there is no panel
   *  to swap (the dev gallery), and the row simply does not render. */
  onOpenLayers?: () => void;
}) {
  const fieldId = useId();
  const shared = sharedRotation(blocks);
  const multiple = blocks.length > 1;
  const layer = layerState(board, blocks);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <SliderField
          id={`${fieldId}-rotation`}
          label="Rotation"
          tip={
            multiple
              ? "Whole degrees, either way from level. Each block turns about its own centre, so a row of blocks stays a row."
              : "Whole degrees, either way from level. The block turns about its own centre and keeps the cells it occupies."
          }
          min={ROTATION_MIN}
          max={ROTATION_MAX}
          // Zero is a real position on this track, so a slider that has never
          // been touched sits in the middle rather than pinned to one end.
          value={shared ?? 0}
          onChange={onRotate}
          ariaLabel="Block rotation"
          valueText={
            shared === null
              ? "Mixed angles"
              : `${shared} degrees`
          }
          statusText={shared === null ? "Mixed" : undefined}
          unit="°"
        />
        <div className="flex gap-1.5">
          {QUICK_ANGLES.map((angle) => (
            <button
              key={angle}
              type="button"
              onClick={() => onRotate(angle)}
              // "Level" rather than "0°": the button CLEARS the tilt, and the
              // word says so where a number would just look like another
              // angle to land on.
              aria-label={angle === 0 ? "Level the block" : `Rotate to ${angle} degrees`}
              className={QUICK_BUTTON_CLASS}
            >
              {angle === 0 ? "Level" : `${angle}°`}
            </button>
          ))}
        </div>
      </div>

      {/* Depth. Purely which block paints on top: the reading order buyers and
          screen readers get is untouched by every one of these. */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <span className={labelClass}>Layer</span>
            <InfoTip label="How layering works">
              Layers decide only what paints on top where blocks overlap; the
              reading order a screen reader follows never changes.
              {multiple && " This selection keeps its own order within the stack as it moves."}
              {layer.stacked && " Alt-click a stack on the canvas to reach the block underneath."}
            </InfoTip>
          </span>
          <span className={helpTextClass}>
            {multiple
              ? `${blocks.length} blocks selected`
              : layer.index === null
                ? ""
                : `Layer ${layer.index + 1} of ${layer.total}`}
          </span>
        </div>
        <div role="group" aria-label="Block layer" className="flex gap-1">
          {LAYER_CONTROLS.map(({ op, label, icon: Icon, end }) => (
            <button
              key={op}
              type="button"
              onClick={() => onReorder(op)}
              // Named for the ACTION, never the arrow: "chevron up" tells a
              // screen reader nothing about what it does to the stack.
              aria-label={label}
              // A control that does nothing is worse than one that says it
              // cannot: both ends disable together, since a selection already
              // at the front has neither a step nor a jump left to make.
              disabled={end === "front" ? layer.atFront : layer.atBack}
              className={LAYER_BUTTON_CLASS}
            >
              <Icon className="size-4" strokeWidth={2} aria-hidden="true" />
            </button>
          ))}
        </div>
        {/* Four buttons answer "move this one"; they cannot answer "what else
            is under here". That is the whole stack, and it opens IN the panel
            rather than over the canvas — a floating layers window would cover
            the very board it describes. */}
        {onOpenLayers && (
          <button
            type="button"
            onClick={onOpenLayers}
            className={SEE_LAYERS_CLASS}
          >
            <span className="flex items-center gap-2">
              <Layers className="size-4" strokeWidth={2} aria-hidden="true" />
              See all layers
            </span>
            <ChevronRight
              className="size-4 shrink-0 text-muted-foreground"
              strokeWidth={2}
              aria-hidden="true"
            />
          </button>
        )}
      </div>
    </div>
  );
}
