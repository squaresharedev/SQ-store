"use client";

import { ArrowUpRight, Landmark } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { stubBadgeClass } from "@/components/ui/control-styles";
import type { PayoutMethod } from "@/lib/payments/types";
import { DetailRow } from "./DetailRow";

/**
 * READ-ONLY view of the payout method. Deliberately not an edit form: bank
 * details are changed on Stripe's hosted dashboard only, so no financial data
 * is ever entered in this app. Shows masked info (last4) exclusively.
 */
export function PayoutMethodModal({
  open,
  onClose,
  method,
}: {
  open: boolean;
  onClose: () => void;
  method: PayoutMethod;
}) {
  function handleManageInStripe() {
    // TODO(stripe): call the server to create a login link for the connected
    // account (stripe.accounts.createLoginLink) and redirect to Stripe's
    // hosted Express dashboard, where the bank account is managed.
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Payout method"
      description="Where your payouts are sent."
    >
      <div className="flex items-center gap-3 rounded-md border border-border bg-muted p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-background text-foreground">
          <Landmark className="size-5" strokeWidth={2} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {method.bankName} ···· {method.last4}
          </p>
          <p className="font-inter text-xs text-muted-foreground">
            Bank account · {method.currency} · {method.country}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-4">
        <DetailRow label="Default for payouts">
          <span className="text-sm text-foreground">
            {method.isDefault ? "Yes" : "No"}
          </span>
        </DetailRow>
        <DetailRow label="Reference">
          <span className="break-all font-mono text-xs text-muted-foreground">
            {method.id}
          </span>
        </DetailRow>
      </div>

      <p className="mt-4 border-t border-border pt-4 font-inter text-sm text-muted-foreground">
        For your security, bank details are changed on Stripe, never here.
      </p>

      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button onClick={handleManageInStripe}>
          Manage in Stripe
          <ArrowUpRight className="size-4" strokeWidth={2} aria-hidden />
          <span className={stubBadgeClass}>Soon</span>
        </Button>
      </div>
    </Modal>
  );
}
