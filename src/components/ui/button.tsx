import * as React from "react";
import { cn } from "@/lib/utils";
import {
  ghostButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "./control-styles";

type Variant = "primary" | "secondary" | "ghost";

// Single source of truth is control-styles.ts, so <Link> CTAs styled with the
// same constants stay pixel-identical to <Button>.
const variantClasses: Record<Variant, string> = {
  // BRAND RULE: primary CTAs are sharp-cornered (rounded-none) — set in
  // primaryButtonClass, never ad hoc per button.
  primary: primaryButtonClass,
  secondary: secondaryButtonClass,
  ghost: ghostButtonClass,
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

/**
 * Shared product-UI button (styles.md §8.3–§8.4): black sharp primary,
 * bordered secondary, quiet ghost. Tokenized motion + focus ring, reduced-
 * motion safe.
 */
export function Button({
  className,
  variant = "primary",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      suppressHydrationWarning
      className={cn(variantClasses[variant], className)}
      {...props}
    />
  );
}
