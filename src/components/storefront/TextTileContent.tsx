"use client";

import { useId, useState } from "react";
import { AlignCenter, AlignLeft, AlignRight, Check } from "lucide-react";
import {
  TEXT_MAX_LENGTH,
  TEXT_VARIANTS,
  type StorefrontTheme,
  type TextAlign,
  type TextBlock,
} from "@/types/storefront";
import { isStrictHexColor } from "@/lib/validation/storefront";
import { cn } from "@/lib/utils";
import { Select, type SelectOption } from "@/components/ui/select";
import { fieldBaseClass, labelClass } from "@/components/ui/control-styles";
import {
  TEXT_ALIGN_CLASSES,
  TEXT_VARIANT_CLASSES,
  TEXT_VARIANT_LABELS,
} from "./config-maps";

export type TextBlockPatch = Partial<
  Pick<TextBlock, "text" | "variant" | "align">
>;

const VARIANT_OPTIONS: readonly SelectOption<
  (typeof TEXT_VARIANTS)[number]
>[] = TEXT_VARIANTS.map((variant) => ({
  value: variant,
  label: TEXT_VARIANT_LABELS[variant],
}));

const ALIGN_ICONS: Record<TextAlign, typeof AlignLeft> = {
  left: AlignLeft,
  center: AlignCenter,
  right: AlignRight,
};

const ALIGN_BUTTON_CLASS =
  "inline-flex size-7 items-center justify-center rounded-none border border-border text-muted-foreground transition-colors duration-180 ease-in-out hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background motion-reduce:transition-none";

/**
 * The text face of a grid tile. View mode renders the text as a plain React
 * text node (never markup); edit mode swaps in an inline editor with a
 * textarea, variant select, and alignment toggles.
 */
export function TextTileContent({
  block,
  theme,
  editing,
  onUpdate,
  onDoneEditing,
}: {
  block: TextBlock;
  theme: StorefrontTheme;
  editing: boolean;
  onUpdate: (patch: TextBlockPatch) => void;
  onDoneEditing: () => void;
}) {
  const fieldId = useId();
  // Local draft so each keystroke doesn't churn the whole grid state.
  const [draft, setDraft] = useState(block.text);

  if (!editing) {
    return (
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col justify-center overflow-hidden whitespace-pre-line p-3",
          TEXT_ALIGN_CLASSES[block.align],
        )}
      >
        <p
          className={cn(TEXT_VARIANT_CLASSES[block.variant])}
          // Headings pick up the accent; body text stays foreground for
          // readability. Accent is schema-gated hex; re-check regardless.
          style={
            block.variant === "heading" && isStrictHexColor(theme.accent)
              ? { color: theme.accent }
              : undefined
          }
        >
          {block.text || "Empty text block"}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
      <div className="space-y-1">
        <label htmlFor={`${fieldId}-text`} className={labelClass}>
          Text
        </label>
        <textarea
          id={`${fieldId}-text`}
          value={draft}
          maxLength={TEXT_MAX_LENGTH}
          rows={2}
          onChange={(event) => {
            setDraft(event.target.value);
            onUpdate({ text: event.target.value });
          }}
          className={cn(fieldBaseClass, "resize-none px-2 py-1.5 text-sm")}
        />
      </div>

      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <label htmlFor={`${fieldId}-variant`} className={labelClass}>
            Style
          </label>
          <Select
            id={`${fieldId}-variant`}
            value={block.variant}
            options={VARIANT_OPTIONS}
            onChange={(variant) => onUpdate({ variant })}
          />
        </div>

        <div role="group" aria-label="Text alignment" className="flex gap-1">
          {(Object.keys(ALIGN_ICONS) as TextAlign[]).map((align) => {
            const Icon = ALIGN_ICONS[align];
            return (
              <button
                key={align}
                type="button"
                onClick={() => onUpdate({ align })}
                aria-label={`Align ${align}`}
                aria-pressed={block.align === align}
                className={cn(
                  ALIGN_BUTTON_CLASS,
                  block.align === align && "bg-accent text-foreground",
                )}
              >
                <Icon className="size-3.5" strokeWidth={2} aria-hidden="true" />
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onDoneEditing}
          aria-label="Done editing text"
          className={cn(ALIGN_BUTTON_CLASS, "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground border-primary")}
        >
          <Check className="size-3.5" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
