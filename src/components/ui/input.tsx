import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

/**
 * Brand text input (styles.md §5.4, light variant): square, white surface,
 * 2px neutral border that goes acid on focus. 16px font is enforced to prevent
 * iOS zoom-on-focus.
 */
export function Input({ className, invalid, style, ...props }: InputProps) {
  return (
    <input
      suppressHydrationWarning
      style={{ fontSize: 16, ...style }}
      className={cn(
        "flex h-auto w-full px-4 py-2.5 text-base font-medium",
        "bg-white text-neutral-900 placeholder:text-neutral-400",
        "border-2 border-neutral-300",
        "transition-colors duration-200",
        "focus-visible:outline-none focus-visible:border-acid focus-visible:ring-0",
        "disabled:opacity-50 disabled:pointer-events-none",
        invalid && "border-red-500 focus-visible:border-red-500",
        className,
      )}
      {...props}
    />
  );
}
