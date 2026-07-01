import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Brand field label: Inter, small, medium weight, sentence case (not uppercase),
 * muted neutral.
 */
export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "font-inter text-sm font-medium text-neutral-700",
        className,
      )}
      {...props}
    />
  );
}
