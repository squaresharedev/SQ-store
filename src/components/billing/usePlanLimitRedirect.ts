"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { ActionError } from "@/lib/errors";

/**
 * For a dialog whose create was refused by a plan limit: returns a function
 * that, given the error, takes the seller to the plans page (the link the
 * error carries names which limit, for the funnel) and says it did, so the
 * dialog closes itself. Any other error returns false and is the caller's to
 * show as usual.
 */
export function usePlanLimitRedirect(): (error: ActionError) => boolean {
  const router = useRouter();
  return React.useCallback(
    (error: ActionError) => {
      if (error.code !== "plan_limit" || !error.action) return false;
      router.push(error.action.href);
      return true;
    },
    [router],
  );
}
