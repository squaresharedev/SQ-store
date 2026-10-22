import { BadgeCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { badgeClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";
import type { AccountStatus } from "@/lib/payments/types";

/**
 * The connection reduced to one line, for a page whose Stripe account is in
 * order (lib/payments/account-health.ts). It carries the tour target the full
 * card carries, so the guided tour lands on whichever one is showing.
 */
export function ConnectionChip({ account }: { account: AccountStatus }) {
  const t = useTranslations("Payments.connection");
  return (
    <p
      data-tour="stripe-connection"
      aria-label={t("label")}
      className={cn(badgeClass, "inline-flex items-center gap-2 border border-border bg-card px-3 py-1.5 text-foreground")}
    >
      <BadgeCheck className="size-4 shrink-0 text-success" strokeWidth={2} aria-hidden />
      <span>{t("connected")}</span>
      {account.accountId && (
        <span className="hidden font-mono font-normal text-muted-foreground sm:inline">
          {account.accountId}
        </span>
      )}
    </p>
  );
}
