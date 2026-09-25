"use client";

import { useId, useMemo } from "react";
import { Crop } from "lucide-react";
import { useTranslations } from "next-intl";
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
  multi = false,
  onUpdate,
  onFrame,
  onDuplicate,
  onRemove,
  removeLabel,
  summons = null,
}: {
  block: ImageBlock;
  /** False when there is no artwork loaded to frame yet. */
  canFrame: boolean;
  /**
   * Driving a whole selection of elements rather than one.
   *
   * Drops the two controls that belong to ONE picture: framing positions this
   * artwork inside this block (there is no group answer to where six different
   * photos should sit), and a description describes what is in the picture, so
   * writing one across six of them would put the same sentence on all six.
   * Fit and opacity are group settings, and stay.
   */
  multi?: boolean;
  onUpdate: (patch: ImageBlockPatch) => void;
  /** Enter frame mode on this block's tile. */
  onFrame: () => void;
  /** Insert a copy of this block (the no-keyboard copy/paste path). */
  onDuplicate: () => void;
  onRemove: () => void;
  /** Overridden when this editor is driving a whole multi-selection, where the
   *  honest word is "Remove 3 blocks". */
  removeLabel?: string;
  /** A control the selection toolbar has pointed at, scrolled to and marked
   *  here rather than duplicated in a popover over the block itself. */
  summons?: BlockFieldSummons;
}) {
  const fieldId = useId();
  const t = useTranslations("Storefront");
  const fit = block.fit ?? "cover";
  const opacity = block.opacity ?? 100;

  /** What each fit does, in the seller's terms rather than CSS's. */
  const fitCopy: Record<ImageFit, { label: string; hint: string }> = useMemo(
    () => ({
      cover: {
        label: t("imageBlock.size.fill"),
        hint: t("imageBlock.size.fillHint"),
      },
      contain: {
        label: t("imageBlock.size.fit"),
        hint: t("imageBlock.size.fitHint"),
      },
    }),
    [t],
  );

  return (
    <div className="space-y-4">
      {/* How the picture fills its block. Two options, so a pair of buttons
          rather than a select: both labels are visible and one press away. */}
      <div className="space-y-1.5">
        <span className={labelClass}>{t("imageBlock.size.label")}</span>
        <div role="group" aria-label={t("imageBlock.size.ariaLabel")} className="flex gap-1">
          {IMAGE_FITS.map((option) => {
            const selected = fit === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => onUpdate({ fit: option })}
                aria-pressed={selected}
                title={fitCopy[option].hint}
                className={cn(
                  FIT_BUTTON_CLASS,
                  selected && "border-foreground bg-accent text-foreground",
                )}
              >
                {fitCopy[option].label}
              </button>
            );
          })}
        </div>
        <p className={helpTextClass}>{fitCopy[fit].hint}</p>
      </div>

      {/* Framing only means something when there IS overflow to position. */}
      {fit === "cover" && !multi && (
        <button
          type="button"
          onClick={onFrame}
          disabled={!canFrame}
          className={cn(secondaryButtonClass, "w-full disabled:opacity-50")}
        >
          <Crop className="size-4" strokeWidth={2} aria-hidden="true" />
          {t("imageBlock.reposition")}
        </button>
      )}

      <SummonedField field="opacity" summons={summons} variant="slider">
        {(highlighted) => (
          <SliderField
            id={`${fieldId}-opacity`}
            label={t("imageBlock.opacity.label")}
            min={0}
            max={100}
            step={5}
            value={opacity}
            onChange={(next) => onUpdate({ opacity: next })}
            ariaLabel={t("imageBlock.opacity.ariaLabel")}
            valueText={t("imageBlock.opacity.valueText", { value: opacity })}
            unit="%"
            highlighted={highlighted}
          />
        )}
      </SummonedField>

      {/* Alt text. Optional on purpose: most elements are decoration, and an
          empty alt is the correct markup for that — inventing a description
          for a divider swoosh makes a screen reader worse, not better. */}
      {!multi && (
      <div className="space-y-1.5">
        <label htmlFor={`${fieldId}-alt`} className={labelClass}>
          {t("imageBlock.description.label")}
        </label>
        <input
          id={`${fieldId}-alt`}
          type="text"
          value={block.alt}
          maxLength={IMAGE_ALT_MAX}
          placeholder={t("imageBlock.description.placeholder")}
          onChange={(event) => onUpdate({ alt: event.target.value })}
          className={fieldBaseClass}
        />
        <p className={helpTextClass}>
          {t("imageBlock.description.hint")}
        </p>
      </div>
      )}

      <BlockActions
        onDuplicate={onDuplicate}
        onRemove={onRemove}
        removeLabel={removeLabel}
      />
    </div>
  );
}
