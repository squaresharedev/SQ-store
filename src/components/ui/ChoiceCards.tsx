"use client";

import * as React from "react";
import { Check, type LucideIcon } from "lucide-react";
import { hoverLiftClass, transitionClass } from "@/components/ui/control-styles";
import { CutoffGlyph, cutoffGlyphGroupClass } from "@/components/ui/CutoffGlyph";
import { cn } from "@/lib/utils";

/** One choosable card: the whole card is the hit area, and the chosen one
 *  takes the ink border. */
const CHOICE_CARD_CLASS =
  "flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 hover:bg-muted/40 has-[:checked]:border-foreground";

/** One choosable TILE: a glyph over a short label. The radio is still there
 *  for the keyboard and for screen readers, only not drawn: it lies over the
 *  whole tile, see-through (TILE_RADIO_CLASS), so a press anywhere lands on
 *  the radio itself, and the tile wears the focus ring and the chosen state. */
const CHOICE_TILE_CLASS = `relative flex cursor-pointer flex-col items-center gap-2 rounded-md border border-border px-2 py-3 text-center hover:bg-muted/40 has-[:checked]:border-foreground has-[:checked]:bg-muted/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background ${transitionClass}`;

/** One SHOWCASE tile: the words top-left and a big glyph bleeding off the
 *  bottom-right corner (CutoffGlyph), for a choice that deserves a picture.
 *  Lifts on hover; the chosen one takes the ink border and a check. */
const CHOICE_SHOWCASE_CLASS = `${cutoffGlyphGroupClass.tile} flex min-h-28 cursor-pointer flex-col justify-end rounded-md border border-border bg-background p-4 text-left hover:border-foreground/40 has-[:checked]:border-foreground has-[:checked]:bg-muted/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background ${hoverLiftClass}`;

/** The chosen showcase tile's check: pops in, top-right. */
const SHOWCASE_CHECK_CLASS =
  "absolute right-3 top-3 grid size-6 place-items-center rounded-full bg-foreground text-background opacity-0 scale-50 transition-[opacity,scale] duration-base ease-entrance group-has-[:checked]/tile-glyph:opacity-100 group-has-[:checked]/tile-glyph:scale-100 motion-reduce:transition-none";

/** A choice that is shown but cannot be picked right now. */
const CHOICE_DISABLED_CLASS =
  "cursor-not-allowed opacity-50 hover:translate-y-0 hover:border-border hover:bg-transparent hover:shadow-none";

/** A tile's radio: the size of the tile, invisible, on top. */
const TILE_RADIO_CLASS = "absolute inset-0 m-0 size-full cursor-pointer opacity-0";

/** Tiles are a grid at every width: two to a row on a phone, where three
 *  would squeeze a label onto three lines. */
const TILE_COLUMNS = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
} as const;

/** Three or fewer tiles asked for three across are ONE row, and stay one on a
 *  phone too: two and an orphan under them reads as a different question. */
const TILE_SINGLE_ROW = "grid-cols-3";

export type ChoiceCardOption<T extends string> = {
  value: T;
  label: React.ReactNode;
  /** A quieter second line under the label. */
  hint?: React.ReactNode;
  /** A glyph for the choice: beside a card's words, over a tile's label. */
  icon?: React.ReactNode;
  /** A small chip with the label ("Recommended"). */
  badge?: React.ReactNode;
  /** Shown, but not pickable right now (the reason is the caller's to say). */
  disabled?: boolean;
  /** The showcase variant's picture, cut off by the tile's corner. */
  glyph?: LucideIcon;
};

/**
 * A short list of choices, one pickable at a time: a native radio group
 * (keyboard, screen readers and forms all work as they should), drawn one of
 * two ways.
 *
 *   cards  a row per choice, for choices that read as a sentence and may
 *          carry a hint under it;
 *   tiles  a glyph over a few words, for choices that can be told apart at a
 *          glance (a way to sign in, a reason to leave). Give every option an
 *          `icon`, and keep the label to a few words.
 *   showcase  a roomier tile with a big glyph cut off by its corner, for the
 *          few headline choices a page is built around (physical or digital,
 *          live or draft). Give every option a `glyph`.
 *
 * `columns` sets short options side by side (cards: two to a row from sm up;
 * tiles: a grid at every width), so the list stays one screen tall.
 *
 * `optionDataAttribute` names a data attribute each option carries with its
 * value (`data-report-scope="seller"`), for tests and agents to find it by.
 */
export function ChoiceCards<T extends string>({
  name,
  legend,
  legendHidden = false,
  options,
  value,
  onChange,
  required = false,
  truncateHints = false,
  variant = "cards",
  columns = 1,
  detached = false,
  optionDataAttribute,
  className,
  fieldsetData,
}: {
  name: string;
  legend: React.ReactNode;
  /** Keep the legend for assistive tech only, where the dialog's own title
   *  already asks the question. */
  legendHidden?: boolean;
  options: readonly ChoiceCardOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  required?: boolean;
  /** One line per hint, ellipsised (for hints that are names, not prose). */
  truncateHints?: boolean;
  variant?: "cards" | "tiles" | "showcase";
  columns?: 1 | 2 | 3;
  /**
   * Keep the radios out of the form around them: for a choice that decides
   * WHICH action a form runs, and so must not be posted as one of its fields.
   */
  detached?: boolean;
  optionDataAttribute?: `data-${string}`;
  className?: string;
  /** Data attributes on the group itself. */
  fieldsetData?: Record<`data-${string}`, string>;
}) {
  // Showcase tiles share the tile grid and the see-through radio.
  const showcase = variant === "showcase";
  const tiles = variant !== "cards";
  return (
    <fieldset className={className} {...fieldsetData}>
      <legend className={legendHidden ? "sr-only" : "pb-2 text-sm font-medium"}>{legend}</legend>
      <div
        className={
          tiles
            ? cn(
                "grid gap-2",
                columns === 3 && options.length === 3 ? TILE_SINGLE_ROW : TILE_COLUMNS[columns],
              )
            : cn("flex flex-col gap-2", columns > 1 && "sm:grid sm:grid-cols-2")
        }
      >
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              showcase ? CHOICE_SHOWCASE_CLASS : tiles ? CHOICE_TILE_CLASS : CHOICE_CARD_CLASS,
              option.disabled && CHOICE_DISABLED_CLASS,
            )}
            {...(optionDataAttribute
              ? { [optionDataAttribute]: option.value }
              : {})}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              disabled={option.disabled}
              className={cn(
                tiles ? TILE_RADIO_CLASS : "mt-0.5 size-4 shrink-0 accent-foreground",
                option.disabled && "cursor-not-allowed",
              )}
              required={required}
              // An id that matches no form: the radio belongs to none.
              form={detached ? "__none__" : undefined}
            />
            {showcase && (
              <>
                {option.glyph && <CutoffGlyph icon={option.glyph} scope="tile" />}
                <span className={SHOWCASE_CHECK_CLASS} aria-hidden="true">
                  <Check className="size-3.5" strokeWidth={3} />
                </span>
              </>
            )}
            {option.icon && <span className="shrink-0 text-foreground">{option.icon}</span>}
            <span
              className={cn(
                "flex min-w-0 flex-col gap-0.5",
                showcase ? "pr-8" : tiles && "items-center",
              )}
            >
              <span
                className={cn(
                  showcase ? "text-base font-semibold" : "text-sm font-medium",
                  tiles && "leading-tight",
                  // Only with a chip to set beside it: a label is free to be
                  // rich inline text otherwise.
                  !tiles && option.badge && "flex flex-wrap items-center gap-2",
                )}
              >
                {option.label}
                {!tiles && option.badge}
              </span>
              {tiles && option.badge}
              {option.hint && (
                <span
                  className={cn(
                    "text-xs text-muted-foreground",
                    truncateHints && "truncate",
                  )}
                >
                  {option.hint}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
