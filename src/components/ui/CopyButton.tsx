"use client";

import * as React from "react";
import { Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatedCheck } from "@/components/ui/animated-check";
import {
  focusRingClass,
  secondaryButtonClass,
  transitionClass,
} from "@/components/ui/control-styles";

/** How long the copied state lingers before reverting to the copy icon. */
const COPIED_MS = 1600;

/**
 * Copy-to-clipboard control: the icon swaps to a self-drawing check on success,
 * then reverts. The check is keyed on a counter so copying twice in a row
 * replays the draw instead of sitting there already-drawn.
 *
 * Two shapes, one behaviour:
 * - `icon` (default): a bare icon button for sitting beside a value.
 * - `labelled`: the shared secondary button, for when copying is the point of
 *   the control rather than an affordance on something else.
 *
 * Clipboard access can be denied (insecure context, permissions policy), so a
 * failure becomes a visible state rather than being silently swallowed — the
 * caller's value is always selectable text as a fallback.
 *
 * The accessible name changes with state, so screen readers hear the result
 * without needing a separate live region.
 */
export function CopyButton({
  value,
  label,
  variant = "icon",
  className,
}: {
  /** Text placed on the clipboard. */
  value: string;
  /** What is being copied, e.g. "order ID". Used for the accessible name. */
  label: string;
  variant?: "icon" | "labelled";
  className?: string;
}) {
  const [copied, setCopied] = React.useState(0);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    if (copied === 0) return;
    const timer = setTimeout(() => setCopied(0), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setFailed(false);
      setCopied((n) => n + 1);
    } catch {
      setFailed(true);
    }
  }

  const isCopied = copied > 0;
  const iconSize = variant === "labelled" ? "size-3.5" : "size-4";

  // Remounted per copy (the key) so the draw animation replays.
  const icon = isCopied ? (
    <AnimatedCheck key={copied} className={iconSize} />
  ) : (
    <Copy className={iconSize} strokeWidth={2} aria-hidden="true" />
  );

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={
        failed
          ? `Couldn't copy ${label}. Select and copy it manually.`
          : isCopied
            ? `Copied ${label}`
            : `Copy ${label}`
      }
      className={cn(
        variant === "labelled"
          ? `${secondaryButtonClass} shrink-0 px-3 py-1.5 text-xs`
          : cn(
              "inline-flex size-8 shrink-0 items-center justify-center rounded-[0.375rem]",
              "text-muted-foreground hover:bg-accent hover:text-foreground",
              transitionClass,
              focusRingClass,
            ),
        isCopied && "text-success hover:text-success",
        failed && "text-destructive hover:text-destructive",
        className,
      )}
    >
      {icon}
      {variant === "labelled" && (failed ? "Copy failed" : isCopied ? "Copied" : "Copy")}
    </button>
  );
}
