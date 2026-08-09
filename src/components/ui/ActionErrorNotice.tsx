import { AlertCircle } from "lucide-react";
import { errorTextClass, helpTextClass } from "@/components/ui/control-styles";
import type { ActionError } from "@/lib/errors";
import { cn } from "@/lib/utils";

/**
 * Standard renderer for a structured ActionError: it always shows what happened
 * AND how to fix it, so no consumer can accidentally drop the fix line.
 * `banner` is the boxed alert used above forms and lists; `inline` is compact
 * stacked text for tight side panels and modals.
 */
export function ActionErrorNotice({
  error,
  variant = "banner",
  className,
}: {
  error: ActionError;
  variant?: "banner" | "inline";
  className?: string;
}) {
  if (variant === "inline") {
    return (
      <div role="alert" className={cn("space-y-0.5", className)}>
        <p className={errorTextClass}>{error.message}</p>
        <p className={helpTextClass}>{error.fix}</p>
      </div>
    );
  }

  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3",
        className,
      )}
    >
      <AlertCircle
        className="mt-0.5 size-4 shrink-0 text-destructive"
        strokeWidth={2}
        aria-hidden="true"
      />
      <div className="space-y-0.5">
        <p className={errorTextClass}>{error.message}</p>
        <p className="font-inter text-sm text-destructive/80">{error.fix}</p>
      </div>
    </div>
  );
}
