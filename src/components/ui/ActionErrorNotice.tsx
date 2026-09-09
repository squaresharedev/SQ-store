import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { errorTextClass, helpTextClass } from "@/components/ui/control-styles";
import type { ActionError } from "@/lib/errors";
import { cn } from "@/lib/utils";

/**
 * Standard renderer for a structured ActionError: it always shows what happened
 * AND how to fix it, so no consumer can accidentally drop the fix line.
 * `banner` is the boxed alert used above forms and lists; `inline` is compact
 * stacked text for tight side panels and modals.
 *
 * An error carrying `action` (see lib/errors.ts) also gets the link that
 * resolves it, in BOTH variants: the errors that carry one are the ones whose
 * fix lives on another page, and a fix line naming a page the user then has to
 * go and find is half an answer.
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
  const action = error.action ? (
    <Link
      href={error.action.href}
      // Outlined rather than filled, matching SellerDetailsNotice: the only
      // solid buttons in this dashboard are its black primaries.
      className="mt-1 inline-flex items-center rounded-sm border border-destructive/40 px-3 py-1.5 font-inter text-xs font-medium text-destructive transition-colors duration-base ease-standard hover:bg-destructive hover:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
    >
      {error.action.label}
    </Link>
  ) : null;

  if (variant === "inline") {
    return (
      <div role="alert" className={cn("space-y-0.5", className)}>
        <p className={errorTextClass}>{error.message}</p>
        <p className={helpTextClass}>{error.fix}</p>
        {action}
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
        {action}
      </div>
    </div>
  );
}
