import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost";

const variantClasses: Record<Variant, string> = {
  // Primary CTA: solid black with white label, square. Reads well on white.
  primary: cn(
    "bg-black text-white border-2 border-black",
    "hover:bg-neutral-800 hover:border-neutral-800",
  ),
  // Solid neutral button for light surfaces (styles.md §5.3).
  secondary: cn(
    "bg-neutral-900 text-white border-2 border-neutral-900",
    "hover:bg-neutral-700 hover:border-neutral-700",
  ),
  // Quiet text button — muted, acid on hover (styles.md §5.7).
  ghost: cn(
    "bg-transparent text-neutral-500 border-2 border-transparent",
    "hover:text-acid",
  ),
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

/**
 * Brand button: square corners, black weight, reduced-motion-safe.
 * Focus ring + press-scale per styles.md §5.1 (light-surface ring offset).
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
      className={cn(
        "inline-flex items-center justify-center gap-2.5",
        "px-7 py-3.5 text-sm font-black whitespace-nowrap select-none",
        "transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-95",
        "motion-reduce:transition-colors motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acid focus-visible:ring-offset-2 focus-visible:ring-offset-white",
        "disabled:opacity-50 disabled:pointer-events-none",
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}
