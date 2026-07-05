"use client";

import { Modal } from "@/components/ui/modal";
import { formatCents } from "@/lib/format/money";
import { formatOrderDate, formatOrderDateTime } from "@/lib/format/date";
import type { Payout } from "@/lib/payments/types";
import { DetailRow } from "./DetailRow";
import { PayoutStatusBadge } from "./PayoutStatusBadge";

/** Read-only detail view for one payout. Masked destination (last4) only. */
export function PayoutDetailModal({
  open,
  onClose,
  payout,
}: {
  open: boolean;
  onClose: () => void;
  payout: Payout;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Payout">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-3xl font-bold text-foreground">
          {formatCents(payout.amountCents, payout.currency)}
        </p>
        <PayoutStatusBadge status={payout.status} />
      </div>

      <div className="mt-6 space-y-4">
        <DetailRow label="Sent to">
          <span className="text-sm text-foreground">
            Bank account ···· {payout.destinationLast4}
          </span>
        </DetailRow>
        <DetailRow label="Arrives">
          <span className="text-sm text-foreground">
            {formatOrderDate(payout.arrivalDate)}
          </span>
        </DetailRow>
        <DetailRow label="Initiated">
          <span className="text-sm text-foreground">
            {formatOrderDateTime(payout.createdAt)}
          </span>
        </DetailRow>
        <DetailRow label="Type">
          <span className="text-sm text-foreground">
            {payout.method === "instant" ? "Instant" : "Standard"}
            {payout.automatic ? " · Automatic" : " · Manual"}
          </span>
        </DetailRow>
        {payout.statementDescriptor && (
          <DetailRow label="On your bank statement">
            <span className="text-sm text-foreground">
              {payout.statementDescriptor}
            </span>
          </DetailRow>
        )}
        <DetailRow label="Payout ID">
          <span className="break-all font-mono text-xs text-muted-foreground">
            {payout.id}
          </span>
        </DetailRow>
      </div>

      {payout.status === "failed" && (
        <p className="mt-4 border-t border-border pt-4 font-inter text-sm text-destructive">
          This payout could not be delivered. Stripe retries automatically, and
          the amount stays in your available balance until it succeeds.
        </p>
      )}
    </Modal>
  );
}
