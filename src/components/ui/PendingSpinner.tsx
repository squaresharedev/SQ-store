"use client";

import { Spinner } from "@/components/ui/spinner";
import { useDelayedPending } from "@/lib/hooks/useDelayedPending";

/**
 * The spinner that answers a click which is taking a while: nothing for the
 * first PENDING_DELAY_MS, then a Spinner. Drop it inside any control whose
 * action is pending (Button does, through its `pending` prop); the control
 * still decides what pending means for clicks.
 */
export function PendingSpinner({ pending, className }: { pending: boolean; className?: string }) {
  const visible = useDelayedPending(pending);
  return visible ? <Spinner className={className} /> : null;
}
