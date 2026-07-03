"use client";

import * as React from "react";
import { X } from "lucide-react";
import { AnimatedCheck } from "@/components/ui/animated-check";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { SettingsActionState } from "@/lib/settings/actions";

/** How long the green/red result treatment lingers before reverting to idle. */
const RESULT_MS = 2500;

/**
 * Submit button for settings forms: the sharp-corner primary CTA with a
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
  ...props
}: ButtonProps & {
  pending: boolean;
  /** Latest action result; drives the green/red status treatment. */
  state?: SettingsActionState;
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
  const [dismissed, setDismissed] = React.useState<SettingsActionState | null>(
    null,
  );
  const settled = !pending && Boolean(state?.success || state?.error);
  const showResult = settled && dismissed !== state;

  React.useEffect(() => {
    if (!showResult) return;
    const timer = setTimeout(() => setDismissed(state ?? null), RESULT_MS);
    return () => clearTimeout(timer);
  }, [showResult, state]);

  if (pending) {
    return (
      <Button type="submit" disabled {...props}>
        <Spinner />
        {pendingLabel}
      </Button>
    );
  }

  if (showResult && state?.success) {
    return (
      <Button
        type="submit"
        className="border-transparent bg-success text-white hover:bg-success/90"
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
        className="border-transparent bg-destructive text-white hover:bg-destructive/90"
        {...props}
      >
        <X aria-hidden className="size-4" />
        {failedLabel ?? children}
      </Button>
    );
  }

  return (
    <Button type="submit" {...props}>
      {children}
    </Button>
  );
}
