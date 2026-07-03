import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface NativeSelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

/**
 * Brand select: a styled native <select> matching the Input treatment (square,
 * 2px neutral border, acid focus) with a lucide chevron. Native for free
 * keyboard/mobile behavior and so it participates in uncontrolled form-action
 * submissions (see TaxSection). For controlled client-state pickers with a
 * typed `options` list, use `./select` instead.
 */
export function NativeSelect({
  className,
  invalid,
  style,
  children,
  ...props
}: NativeSelectProps) {
  return (
    <div className={cn("relative", className)}>
      <select
        suppressHydrationWarning
        style={{ fontSize: 16, ...style }}
        className={cn(
          "w-full appearance-none px-4 py-2.5 pr-10 text-base font-medium",
          "bg-white text-neutral-900",
          "border-2 border-neutral-300",
          "transition-colors duration-200",
          "focus-visible:outline-none focus-visible:border-acid focus-visible:ring-0",
          "disabled:opacity-50 disabled:pointer-events-none",
          invalid && "border-red-500 focus-visible:border-red-500",
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400"
      />
    </div>
  );
}
