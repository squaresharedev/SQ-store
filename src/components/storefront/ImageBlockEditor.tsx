"use client";

import { useId } from "react";
import { Crop } from "lucide-react";
import {
  IMAGE_ALT_MAX,
  IMAGE_FITS,
  type ImageBlock,
  type ImageFit,
} from "@/types/storefront";
import { cn } from "@/lib/utils";
import {
  fieldBaseClass,
  focusRingClass,
  helpTextClass,
  labelClass,
  secondaryButtonClass,
  transitionClass,
} from "@/components/ui/control-styles";
import { SliderField } from "@/components/ui/SliderField";
import { BlockActions } from "./BlockActions";
import { SummonedField, type BlockFieldSummons } from "./SummonedField";

export type ImageBlockPatch = Partial<
  Pick<ImageBlock, "alt" | "fit" | "opacity">
>;

/** What each fit does, in the seller's terms rather than CSS's. */
const FIT_COPY: Record<ImageFit, { label: string; hint: string }> = {
  cover: { label: "Fill", hint: "Fills the block, cropping the overflow." },
  contain: { label: "Fit", hint: "Shows the whole image inside the block." },
};

const FIT_BUTTON_CLASS = `inline-flex flex-1 items-center justify-center rounded-none border border-border bg-background px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground ${transitionClass} ${focusRingClass}`;

/**
 * Inspector card body for an IMAGE block: the seller's own artwork on the
 * canvas. Alt text, how it fills its block, opacity, and the way into framing.
 * Patches emit on each change; no "save" step.
 *
 * There is no control for the picture itself — replacing artwork means adding
 * a new element and deleting this one, which keeps one block pointing at one
 * stored object for its whole life. That is what lets the save path evict a
 * detached upload the moment its block goes.
 */
export function ImageBlockEditor({
  block,
  canFrame,
  onUpdate,
  onFrame,
  onDuplicate,
  onRemove,
  summons = null,
}: {
  block: ImageBlock;
  /** False when there is no artwork loaded to frame yet. */
  canFrame: boolean;
  onUpdate: (patch: ImageBlockPatch) => void;
  /** Enter frame mode on this block's tile. */
  onFrame: () => void;
  /** Insert a copy of this block (the no-keyboard copy/paste path). */
  onDuplicate: () => void;
  onRemove: () => void;
  /** A control the selection toolbar has pointed at, scrolled to and marked
   *  here rather than duplicated in a popover over the block itself. */
  summons?: BlockFieldSummons;
}) {
  const fieldId = useId();
  const fit = block.fit ?? "cover";
  const opacity = block.opacity ?? 100;

  return (
    <div className="space-y-4">
      {/* How the picture fills its block. Two options, so a pair of buttons
          rather than a select: both labels are visible and one press away. */}
      <div className="space-y-1.5">
        <span className={labelClass}>Size</span>
        <div role="group" aria-label="Image fit" className="flex gap-1">
          {IMAGE_FITS.map((option) => {
            const selected = fit === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => onUpdate({ fit: option })}
                aria-pressed={selected}
                title={FIT_COPY[option].hint}
                className={cn(
                  FIT_BUTTON_CLASS,
                  selected && "border-foreground bg-accent text-foreground",
                )}
              >
                {FIT_COPY[option].label}
              </button>
            );
          })}
        </div>
        <p className={helpTextClass}>{FIT_COPY[fit].hint}</p>
      </div>

      {/* Framing only means something when there IS overflow to position. */}
      {fit === "cover" && (
        <button
          type="button"
          onClick={onFrame}
          disabled={!canFrame}
          className={cn(secondaryButtonClass, "w-full disabled:opacity-50")}
        >
          <Crop className="size-4" strokeWidth={2} aria-hidden="true" />
          Reposition image
        </button>
      )}

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
            ariaLabel="Image opacity"
            valueText={`${opacity} percent`}
            unit="%"
            highlighted={highlighted}
          />
        )}
      </SummonedField>

      {/* Alt text. Optional on purpose: most elements are decoration, and an
          empty alt is the correct markup for that — inventing a description
          for a divider swoosh makes a screen reader worse, not better. */}
      <div className="space-y-1.5">
        <label htmlFor={`${fieldId}-alt`} className={labelClass}>
          Description
        </label>
        <input
          id={`${fieldId}-alt`}
          type="text"
          value={block.alt}
          maxLength={IMAGE_ALT_MAX}
          placeholder="Logo, icon, decoration…"
          onChange={(event) => onUpdate({ alt: event.target.value })}
          className={fieldBaseClass}
        />
        <p className={helpTextClass}>
          Read aloud by screen readers. Leave it empty if the image is purely
          decorative.
        </p>
      </div>

      <BlockActions onDuplicate={onDuplicate} onRemove={onRemove} />
    </div>
  );
}
