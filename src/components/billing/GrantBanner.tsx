"use client";

import { Gift, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { formatLongDate } from "@/lib/format/date";
import { useStoredFlag } from "@/lib/hooks/useStoredFlag";
import { helpTextClass, iconButtonClass } from "@/components/ui/control-styles";
import { cardClass, iconTileClass } from "@/components/ui/surface-styles";
import type { PaidPlanId } from "@/lib/billing/plans";

/**
 * Remembers, on this device, that the "on us" banner was closed. Suffixed with
 * the grant itself (plan and end), so a new grant, a longer one or a change of
 * plan is news again and shows again.
 */
export const GRANT_BANNER_DISMISSED_KEY = "sq.billing.grant-banner-dismissed";

/** The storage key for one grant. */
export function grantBannerKey(grant: { plan: PaidPlanId; endsAt: string | null }): string {
  return `${GRANT_BANNER_DISMISSED_KEY}.${grant.plan}.${grant.endsAt ?? "open"}`;
}

/**
 * "Pro is on us": a plan Square Share gave the store, said once at the top of
 * the plans page, with when it ends. A gift, so a gift's mark; closable,
 * because it is good news to read once, not a condition to act on.
 */
export function GrantBanner({ grant }: { grant: { plan: PaidPlanId; endsAt: string | null } }) {
  const t = useTranslations("Billing");
  const tCommon = useTranslations("Common");
  const locale = useLocale();
  const [dismissed, setDismissed] = useStoredFlag(grantBannerKey(grant));
  if (dismissed) return null;

  const plan = t(`plans.${grant.plan}.name`);
  return (
    <div
      role="status"
      data-grant-banner={grant.plan}
      className={cn(cardClass, "mx-auto flex w-full max-w-2xl items-center gap-4 px-4 py-3")}
    >
      <span aria-hidden className={cn(iconTileClass, "size-10 bg-foreground text-background")}>
        <Gift className="size-5" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">{t("page.grantTitle", { plan })}</p>
        <p className={helpTextClass}>
          {grant.endsAt
            ? t("settings.grantUntil", { date: formatLongDate(grant.endsAt, locale) })
            : t("settings.grantNoEnd")}
        </p>
      </div>
      <button
        type="button"
        className={cn(iconButtonClass, "shrink-0 border-transparent bg-transparent")}
        aria-label={tCommon("actions.close")}
        onClick={() => setDismissed(true)}
      >
        <X className="size-4" strokeWidth={2} aria-hidden />
      </button>
    </div>
  );
}
