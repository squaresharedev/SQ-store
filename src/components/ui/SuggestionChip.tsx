"use client";

import { useEffect, useId, useRef, type ComponentProps } from "react";
import { Check, Undo2, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { chipButtonClass, infoTextClass, suggestionChipClass } from "@/components/ui/control-styles";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/Tooltip";

/**
 * A chip the app is GUESSING (lib/predictions.ts) or offering to write with AI
 * (lib/suggestions): the flowing rim every suggestion wears, and on hover or
 * focus a sentence (`hint`) saying where the guess came from and what a tap
 * does, because "Same as Linen shirt" alone does not say it is a suggestion or
 * what it will copy. Screen readers get the same sentence as the button's
 * description.
 *
 * `busy` while a tap's answer is on its way: a spinner in place of the icon,
 * and the button stays focusable (aria-disabled, not disabled, so a keyboard
 * user keeps their place) but ignores further taps.
 */
export function SuggestionButton({
  icon: Icon,
  hint,
  busy = false,
  className,
  children,
  onClick,
  ...props
}: ComponentProps<"button"> & { icon: LucideIcon; hint: string; busy?: boolean }) {
  const hintId = useId();
  return (
    <Tooltip hint label={hint} className="max-w-full">
      <button
        type="button"
        {...props}
        onClick={busy ? undefined : onClick}
        aria-disabled={busy || undefined}
        aria-busy={busy || undefined}
        className={cn(suggestionChipClass, "max-w-full", busy && "cursor-progress", className)}
        aria-describedby={hintId}
      >
        {busy ? (
          <Spinner className="size-3.5 shrink-0" />
        ) : (
          <Icon className="size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
        )}
        {children}
      </button>
      <span id={hintId} hidden>
        {hint}
      </span>
    </Tooltip>
  );
}

/**
 * A one-tap suggestion, and once taken, what it did with a curved arrow beside
 * it that takes it back: one tap in, one tap out. Never applied by itself. The
 * owner decides when it shows, whether it is `done` (still exactly as the tap
 * left it), and what the undo restores.
 *
 * Focus follows a KEYBOARD press: onto the arrow once applied, back onto the
 * chip once undone, so a keyboard user is never dropped to the top of the
 * page. A mouse or a finger leaves focus alone, or the arrow's focus label
 * would pop up after every tap.
 */
export function SuggestionChip({
  icon,
  label,
  hint,
  done,
  busy = false,
  onApply,
  onUndo,
}: {
  icon: LucideIcon;
  label: string;
  /** Where the guess came from and what a tap does, shown on hover and focus. */
  hint: string;
  done: boolean;
  /** The tap's answer is still on its way (an AI suggestion). */
  busy?: boolean;
  onApply: () => void;
  onUndo: () => void;
}) {
  const t = useTranslations("Common.actions");
  const labelId = useId();
  const chipRef = useRef<HTMLButtonElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  // Set by a keyboard press here (a click with no pointer, `detail` 0), so
  // focus only moves when this chip had it from the keyboard.
  const pressed = useRef(false);

  useEffect(() => {
    if (!pressed.current) return;
    pressed.current = false;
    (done ? undoRef : chipRef).current?.focus();
  }, [done]);

  if (!done) {
    return (
      <SuggestionButton
        ref={chipRef}
        icon={icon}
        hint={hint}
        busy={busy}
        onClick={(event) => {
          pressed.current = event.detail === 0;
          onApply();
        }}
        data-suggestion=""
      >
        <span className="truncate">{label}</span>
      </SuggestionButton>
    );
  }
  return (
    <span className="inline-flex max-w-full items-center gap-1.5" data-suggestion-done="">
      <Check className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden="true" />
      <span id={labelId} className={cn(infoTextClass, "truncate")}>
        {label}
      </span>
      <Tooltip label={t("undo")} className="shrink-0">
        <button
          ref={undoRef}
          type="button"
          // The chip's own box, so swapping one for the other never moves the form.
          className={cn(chipButtonClass, "px-2")}
          onClick={(event) => {
            pressed.current = event.detail === 0;
            onUndo();
          }}
          aria-label={t("undo")}
          aria-describedby={labelId}
          data-suggestion-undo=""
        >
          <Undo2 className="size-4" strokeWidth={2} aria-hidden="true" />
        </button>
      </Tooltip>
    </span>
  );
}
