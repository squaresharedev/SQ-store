"use client";

import { Ticket, TimerOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { HeroMark } from "@/components/ui/HeroMark";

/**
 * The one confirm before a running sale ends, asked the same way from its row
 * in the list and from its edit form: the ticket, stopped. Prices go back to
 * normal straight away, so it cannot be taken back.
 */
export function EndSaleDialog({
  open,
  pending,
  onClose,
  onConfirm,
}: {
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations("Discounts.confirmEnd");
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      tone="danger"
      visual={<HeroMark icon={Ticket} tone="danger" badge={TimerOff} />}
      title={t("title")}
      description={t("body")}
      confirmLabel={t("confirm")}
      pending={pending}
      onConfirm={onConfirm}
    />
  );
}
