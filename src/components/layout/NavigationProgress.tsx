"use client";

import { useTranslations } from "next-intl";
import { navProgressBarClass, navProgressClass } from "@/components/ui/surface-styles";
import { useDelayedPending } from "@/lib/hooks/useDelayedPending";
import { useAnyProgress } from "@/lib/hooks/useProgressWhile";

/**
 * The answer to "I clicked and nothing happened": a thin bar across the top of
 * the window, shown once work the seller started has taken longer than
 * PENDING_DELAY_MS (ui/motion-tokens). Work that lands quicker never shows it,
 * and a route with a loading.tsx skeleton usually navigates before it could.
 *
 * It owns no detection. Whatever is slow registers itself, through
 * useProgressWhile, and this shows while anything is registered:
 *
 *   - every link (ui/AppLink), for a page change,
 *   - usePendingRouter, for a navigation started from code,
 *   - a control that has already left the screen (a closed menu) for its action.
 *
 * A control that stays on screen shows its own `pending` instead (ui/button).
 */
export function NavigationProgress() {
  const t = useTranslations("Common.actions");
  const visible = useDelayedPending(useAnyProgress());

  return (
    <>
      <p role="status" className="sr-only">
        {visible ? t("loading") : ""}
      </p>
      {visible ? (
        <div aria-hidden="true" className={navProgressClass}>
          <div className={navProgressBarClass} />
        </div>
      ) : null}
    </>
  );
}
