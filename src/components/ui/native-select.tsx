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
 * submissions.
 *
 * CURRENTLY UNUSED in the product UI: the dashboard uses `./select` (a listbox
 * that carries the settings/dropdown styling and can't be themed natively),
 * with the chosen value submitted via a hidden input. Kept for auth/marketing
 * surfaces, which still wear this heavier brutalist treatment.
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
          "bg-background text-foreground",
          "border-2 border-input",
          "transition-colors duration-base ease-standard motion-reduce:transition-none",
          "focus-visible:outline-none focus-visible:border-acid focus-visible:ring-0",
          "disabled:opacity-50 disabled:pointer-events-none",
          invalid && "border-destructive focus-visible:border-destructive",
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}
