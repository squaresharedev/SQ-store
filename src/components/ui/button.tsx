import * as React from "react";
import { cn } from "@/lib/utils";
import { PendingSpinner } from "./PendingSpinner";
import {
  destructiveButtonClass,
  ghostButtonClass,
  ghostDangerButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "./control-styles";

type Variant =
  | "primary"
  | "secondary"
  | "ghost"
  | "ghost-danger"
  | "destructive";

// Single source of truth is control-styles.ts, so <Link> CTAs styled with the
// same constants stay pixel-identical to <Button>.
const variantClasses: Record<Variant, string> = {
  // BRAND RULE: primary CTAs are sharp-cornered (rounded-none) — set in
  // primaryButtonClass, never ad hoc per button.
  primary: primaryButtonClass,
  secondary: secondaryButtonClass,
  ghost: ghostButtonClass,
  "ghost-danger": ghostDangerButtonClass,
  destructive: destructiveButtonClass,
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /**
   * The button's action is under way. It stops taking clicks at once; a
   * spinner joins the label only if the wait outlasts PENDING_DELAY_MS, so a
   * fast action never flashes one. The label stays: the button keeps its
   * width and says what it is doing.
   */
  pending?: boolean;
}

/**
 * The Button classes as a standalone string, for the rare element that must
 * look like a button but be something else (e.g. a download <a>).
 */
export function buttonClassName(variant: Variant = "primary", className?: string) {
  return cn(variantClasses[variant], className);
}

/**
 * Shared product-UI button (styles.md §8.3–§8.4): black sharp primary,
 * bordered secondary, quiet ghost, ghost that turns red on hover, outlined
 * destructive. Tokenized motion + focus ring, reduced-motion safe.
 */
export function Button({
  className,
  variant = "primary",
  type = "button",
  pending = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      suppressHydrationWarning
      aria-busy={pending || undefined}
      disabled={disabled || pending}
      // A pending button is locked, not greyed: dimming it for a wait too short
      // to see is the flash the delay exists to prevent.
      className={buttonClassName(variant, cn(className, "aria-busy:disabled:opacity-100"))}
      {...props}
    >
      <PendingSpinner pending={pending} />
      {children}
    </button>
  );
}
