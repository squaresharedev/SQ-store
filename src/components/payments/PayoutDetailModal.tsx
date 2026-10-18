"use client";

import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Modal, ModalActions } from "@/components/ui/modal";
import { formatCents } from "@/lib/format/money";
import type { Payout, PayoutMethod } from "@/lib/payments/types";
import { DetailRow } from "./DetailRow";
import { PayoutStatusBadge } from "./PayoutStatusBadge";
import { PayoutTrack } from "./PayoutTrack";

/**
 * Read-only detail view for one payout, all of it on screen at once: the
 * amount and its status, one picture of how far it has got (PayoutTrack), and
 * the facts under a rule. Nothing folds away: a detail view has nothing to
 * decide, so everything it knows is the point. Masked destination (last4) only.
 */
export function PayoutDetailModal({
  open,
  onClose,
  payout,
  method,
}: {
  open: boolean;
  onClose: () => void;
  payout: Payout;
  /** The payout account on file; names the bank when the payout went to it. */
  method?: PayoutMethod | null;
}) {
  const t = useTranslations("Payments.payoutModal");
  const actions = useTranslations("Common.actions");
  const locale = useLocale();
  const bankName = method?.last4 === payout.destinationLast4 ? method.bankName : undefined;
  return (
    <Modal open={open} onClose={onClose} title={t("title")}>
      {/* Wraps on a narrow sheet: the status drops under the amount, which is never cut short. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="text-3xl font-bold tabular-nums text-foreground">
          {formatCents(payout.amountCents, payout.currency, locale)}
        </p>
        <PayoutStatusBadge status={payout.status} />
      </div>

      <PayoutTrack payout={payout} className="mt-6" />

      {payout.status === "failed" && (
        <p className="mt-4 font-inter text-sm text-danger-strong">{t("failed")}</p>
      )}

      <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-border pt-6">
        <DetailRow label={t("sentTo")}>
          <span className="text-sm text-foreground">
            {bankName
              ? `${bankName} ···· ${payout.destinationLast4}`
              : t("bankAccount", { last4: payout.destinationLast4 })}
          </span>
        </DetailRow>
        <DetailRow label={t("type")}>
          <span className="text-sm text-foreground">
            {t("typeValue", {
              method: payout.method,
              automatic: payout.automatic ? "true" : "false",
            })}
          </span>
        </DetailRow>
        {payout.statementDescriptor && (
          <DetailRow label={t("statement")}>
            <span className="text-sm text-foreground">{payout.statementDescriptor}</span>
          </DetailRow>
        )}
        <DetailRow label={t("id")}>
          <span className="break-all font-mono text-xs text-foreground">{payout.id}</span>
        </DetailRow>
      </div>

      <ModalActions className="mt-6">
        <Button onClick={onClose}>{actions("done")}</Button>
      </ModalActions>
    </Modal>
  );
}
