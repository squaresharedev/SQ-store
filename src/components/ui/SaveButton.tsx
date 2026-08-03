"use client";

import * as React from "react";
import { X } from "lucide-react";
import { AnimatedCheck } from "@/components/ui/animated-check";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
/**
 * The result shape this button reads. Deliberately structural rather than
 * tied to one feature's action type: settings, team AND the product form all
 * feed it, and SaveResult satisfies this by construction.
 */
export type SaveResult = { success?: string; error?: string };

/** How long the green/red result treatment lingers before reverting to idle. */
const RESULT_MS = 2500;

/**
 * THE submit button for forms across the app (settings, team, products): the sharp-corner primary CTA with a
 * built-in pending state, plus result feedback baked into the button itself —
 * it flips solid green with a check ("Saved") when the last submit succeeded,
 * or solid red with a cross when it failed, then reverts after a couple of
 * seconds. The button IS the success confirmation, so forms don't also print a
 * redundant "saved" line (FormStatus only shows errors / opt-in info).
 *
 * Pass `variant="destructive"` for dangerous actions; the success/fail
 * treatment overrides the base variant while a result is showing.
 */
export function SaveButton({
  pending,
  state,
  pendingLabel = "Saving…",
  savedLabel = "Saved",
  failedLabel,
  children = "Save",
  className,
  ...props
}: ButtonProps & {
  pending: boolean;
  /** Latest action result; drives the green/red status treatment. */
  state?: SaveResult;
  pendingLabel?: string;
  /** Label shown alongside the green check (defaults to "Saved"). */
  savedLabel?: React.ReactNode;
  /** Label shown alongside the red cross (defaults to `children`). */
  failedLabel?: React.ReactNode;
}) {
  // Show the result treatment briefly after a settled submit, then fade back to
  // the plain button. A fresh submit returns a new `state` object (even with
  // identical text), so it differs from the last-dismissed one and shows again.
  // Only the timer mutates state — keeps this off React's cascading-render path.
  const [dismissed, setDismissed] = React.useState<SaveResult | null>(
    null,
  );
  const settled = !pending && Boolean(state?.success || state?.error);
  const showResult = settled && dismissed !== state;

  React.useEffect(() => {
    if (!showResult) return;
    const timer = setTimeout(() => setDismissed(state ?? null), RESULT_MS);
    return () => clearTimeout(timer);
  }, [showResult, state]);

  // A caller's `className` is MERGED into each state's treatment, never spread
  // over the top of it: layout classes from the parent (e.g. `shrink-0` when
  // the button sits beside a field) must not wipe out the green/red fill.
  if (pending) {
    return (
      <Button type="submit" disabled className={className} {...props}>
        <Spinner />
        {pendingLabel}
      </Button>
    );
  }

  // The result states fill with a saturated feedback colour, and white is the
  // legible pairing for both in any theme — these are not neutrals that should
  // follow the surface.
  if (showResult && state?.success) {
    return (
      <Button
        type="submit"
        className={cn(
          "border-transparent bg-success text-white hover:bg-success/90",
          className,
        )}
        {...props}
      >
        <AnimatedCheck className="size-4" />
        {savedLabel}
      </Button>
    );
  }

  if (showResult && state?.error) {
    return (
      <Button
        type="submit"
        className={cn(
          "border-transparent bg-destructive text-white hover:bg-destructive/90",
          className,
        )}
        {...props}
      >
        <X aria-hidden className="size-4" />
        {failedLabel ?? children}
      </Button>
    );
  }

  return (
    <Button type="submit" className={className} {...props}>
      {children}
    </Button>
  );
}
