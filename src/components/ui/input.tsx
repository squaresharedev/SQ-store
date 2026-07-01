import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

/**
 * Brand text input (styles.md §5.4, dark variant): square, translucent surface,
 * 2px border that goes acid on focus. 16px font is enforced globally to prevent
 * iOS zoom-on-focus.
 */
export function Input({ className, invalid, style, ...props }: InputProps) {
  return (
    <input
      suppressHydrationWarning
      style={{ fontSize: 16, ...style }}
      className={cn(
        "flex h-auto w-full px-4 py-3.5 text-base font-medium",
        "bg-white/5 text-white placeholder:text-white/30",
        "border-2 border-white/20",
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
