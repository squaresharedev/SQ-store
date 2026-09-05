import * as React from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps extends React.ComponentProps<"textarea"> {
  invalid?: boolean;
}

/** Multi-line sibling of Input (styles.md §5.4): same square, surface-coloured,
 *  2px-border-that-goes-acid-on-focus treatment, just resizable vertically. */
export function Textarea({ className, invalid, style, ...props }: TextareaProps) {
  return (
    <textarea
      suppressHydrationWarning
      style={{ fontSize: 16, ...style }}
      className={cn(
        "flex w-full resize-y px-4 py-2.5 text-base font-medium",
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
