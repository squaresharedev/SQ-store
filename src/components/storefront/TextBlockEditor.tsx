"use client";

import { useId, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Underline,
} from "lucide-react";
import {
  TEXT_MAX_LENGTH,
  TEXT_VARIANTS,
  type TextAlign,
  type TextBlock,
} from "@/types/storefront";
import { cn } from "@/lib/utils";
import { Select, type SelectOption } from "@/components/ui/select";
import { fieldBaseClass, labelClass } from "@/components/ui/control-styles";
import { TEXT_VARIANT_LABELS } from "./config-maps";

export type TextBlockPatch = Partial<
  Pick<
    TextBlock,
    "text" | "variant" | "align" | "bold" | "italic" | "underline"
  >
>;

const VARIANT_OPTIONS: readonly SelectOption<(typeof TEXT_VARIANTS)[number]>[] =
  TEXT_VARIANTS.map((variant) => ({
    value: variant,
    label: TEXT_VARIANT_LABELS[variant],
  }));

const ALIGN_ICONS: Record<TextAlign, typeof AlignLeft> = {
  left: AlignLeft,
  center: AlignCenter,
  right: AlignRight,
};

const TOGGLE_CLASS =
  "inline-flex size-8 items-center justify-center rounded-none border border-border text-muted-foreground transition-colors duration-180 ease-in-out hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background motion-reduce:transition-none";

/**
 * Text-block editor rendered in the side panel: content, style, formatting, and
 * alignment. Every change is applied live (no "done" step); the tile updates as
 * you type. The tile itself just displays the text.
 */
export function TextBlockEditor({
  block,
  onUpdate,
}: {
  block: TextBlock;
  onUpdate: (patch: TextBlockPatch) => void;
}) {
  const fieldId = useId();
  // Local draft so each keystroke doesn't churn the whole grid state.
  const [draft, setDraft] = useState(block.text);

  // Adopt an external switch to a different text block.
  const [prevId, setPrevId] = useState(block.id);
  if (block.id !== prevId) {
    setPrevId(block.id);
    setDraft(block.text);
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor={`${fieldId}-text`} className={labelClass}>
          Text
        </label>
        <textarea
          id={`${fieldId}-text`}
          value={draft}
          maxLength={TEXT_MAX_LENGTH}
          rows={3}
          onChange={(event) => {
            setDraft(event.target.value);
            onUpdate({ text: event.target.value });
          }}
          className={cn(fieldBaseClass, "resize-none text-sm")}
        />
      </div>

      <div className="space-y-1.5">
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

      <div className="space-y-1.5">
        <span className={labelClass}>Format</span>
        <div role="group" aria-label="Text formatting" className="flex gap-1">
          <button
            type="button"
            onClick={() => onUpdate({ bold: !block.bold })}
            aria-label="Bold"
            aria-pressed={!!block.bold}
            className={cn(TOGGLE_CLASS, block.bold && "bg-accent text-foreground")}
          >
            <Bold className="size-4" strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onUpdate({ italic: !block.italic })}
            aria-label="Italic"
            aria-pressed={!!block.italic}
            className={cn(TOGGLE_CLASS, block.italic && "bg-accent text-foreground")}
          >
            <Italic className="size-4" strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onUpdate({ underline: !block.underline })}
            aria-label="Underline"
            aria-pressed={!!block.underline}
            className={cn(
              TOGGLE_CLASS,
              block.underline && "bg-accent text-foreground",
            )}
          >
            <Underline className="size-4" strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        <span className={labelClass}>Alignment</span>
        <div role="group" aria-label="Text alignment" className="flex gap-1">
          {(Object.keys(ALIGN_ICONS) as TextAlign[]).map((align) => {
            const Icon = ALIGN_ICONS[align];
            const active = block.align === align;
            return (
              <button
                key={align}
                type="button"
                onClick={() => onUpdate({ align })}
                aria-label={`Align ${align}`}
                aria-pressed={active}
                className={cn(TOGGLE_CLASS, active && "bg-accent text-foreground")}
              >
                <Icon className="size-4" strokeWidth={2} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
