import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost";

const variantClasses: Record<Variant, string> = {
  // Signature acid CTA (a simplified, square stand-in for the marketplace's
  // canvas "PixelButton" — swap PixelButton in here later if desired). Acid
  // fill + black label, crossfading to near-black + acid label on hover.
  primary: cn(
    "bg-acid text-black border-2 border-acid",
    "hover:bg-[#0a0a0a] hover:text-acid hover:border-acid",
    "shadow-btn-glow",
  ),
  // Solid neutral button (styles.md §5.3).
  secondary: cn(
    "bg-white text-black border-2 border-white",
    "hover:bg-white/85 hover:border-white/85",
  ),
  // Quiet text button — muted, acid on hover (styles.md §5.7).
  ghost: cn(
    "bg-transparent text-white/50 border-2 border-transparent",
    "hover:text-acid",
  ),
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

/**
 * Brand button: square corners, black weight, reduced-motion-safe.
 * Focus ring + press-scale per styles.md §5.1.
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
        "transition-colors duration-200 active:scale-95",
        "motion-reduce:transition-none motion-reduce:active:scale-100",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acid focus-visible:ring-offset-2 focus-visible:ring-offset-black",
        "disabled:opacity-50 disabled:pointer-events-none",
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}
