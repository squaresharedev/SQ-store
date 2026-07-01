import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Brand field label (styles.md §3.3 eyebrow pattern): mono, xs, uppercase,
 * wide tracking, faint.
 */
export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "font-mono text-xs uppercase tracking-[0.2em] text-white/50",
        className,
      )}
      {...props}
    />
  );
}
