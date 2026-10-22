import { useTranslations } from "next-intl";
import { accountIsInOrder } from "@/lib/payments/account-health";
import type { AccountStatus } from "@/lib/payments/types";
import { ConnectionChip } from "./ConnectionChip";
import { ConnectionStatusCard } from "./ConnectionStatusCard";

/**
 * The title, and where the Stripe connection stands. An account in order is a
 * one-line chip beside the title, out of the way of the money; one that is not
 * keeps the full card straight under it, ahead of everything, because it is
 * what the seller has to act on.
 */
export function PaymentsHeader({
  account,
  onConnect,
}: {
  account: AccountStatus;
  onConnect: () => void;
}) {
  const t = useTranslations("Payments");
  const inOrder = accountIsInOrder(account);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="text-2xl font-semibold text-foreground md:text-3xl">{t("pageTitle")}</h1>
        {inOrder && <ConnectionChip account={account} />}
      </div>
      {!inOrder && <ConnectionStatusCard account={account} onConnect={onConnect} />}
    </>
  );
}
