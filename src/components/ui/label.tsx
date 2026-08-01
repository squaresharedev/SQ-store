import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Brand field label: Inter, small, medium weight, sentence case (not
 * uppercase). Uses the foreground token — a label names the control it sits
 * above, so it is primary text, not muted chrome.
 */
export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "font-inter text-sm font-medium text-foreground",
        className,
      )}
      {...props}
    />
  );
}
