import * as React from "react";
import { cn } from "@/lib/utils";

/** `ComponentProps` rather than `InputHTMLAttributes` so `ref` is part of the
 *  prop type — React 19 passes it straight through with the rest. */
export interface InputProps extends React.ComponentProps<"input"> {
  invalid?: boolean;
}

/**
 * Brand text input (styles.md §5.4): square, surface-coloured, 2px border that
 * goes acid on focus. 16px font is enforced to prevent iOS zoom-on-focus.
 *
 * Colours are semantic tokens, not fixed neutrals, so the control follows the
 * theme instead of pinning itself to a white page.
 */
export function Input({ className, invalid, style, ...props }: InputProps) {
  return (
    <input
      suppressHydrationWarning
      style={{ fontSize: 16, ...style }}
      className={cn(
        "flex h-auto w-full px-4 py-2.5 text-base font-medium",
        "bg-background text-foreground placeholder:text-muted-foreground",
        "border-2 border-input",
        "transition-colors duration-base ease-standard motion-reduce:transition-none",
        "focus-visible:outline-none focus-visible:border-acid focus-visible:ring-0",
        "disabled:opacity-50 disabled:pointer-events-none",
        invalid && "border-destructive focus-visible:border-destructive",
        className,
      )}
      {...props}
    />
  );
}
