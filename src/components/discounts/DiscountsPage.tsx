"use client";

import { useMemo, useState, useTransition } from "react";
import { Ticket, TimerOff, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { HeroMark } from "@/components/ui/HeroMark";
import { useToast } from "@/components/ui/Toast";
import { useActionErrorToast } from "@/components/ui/ActionErrorNotice";
import { helpTextClass } from "@/components/ui/control-styles";
import { deleteDiscount, endSale, setCodeEnabled, type DiscountActionResult } from "@/lib/discounts/actions";
import { coveredProducts } from "@/lib/discounts/covered";
import type { DiscountsSummary } from "@/lib/discounts/summary";
import type { DiscountProductChoice } from "@/types/discount";
import { DiscountEmptyState } from "./DiscountEmptyState";
import { DiscountPerformance } from "./DiscountPerformance";
import { DiscountRow } from "./DiscountRow";

/** A confirm before the two writes that cannot be taken back. */
type Pending = { kind: "delete" | "end"; id: string } | null;

/**
 * THE DISCOUNTS PAGE: what the discounts brought in, then every discount with
 * its controls. Composition only: the figures arrive worked out
 * (lib/discounts/summary.ts) and every write is a server action that re-checks
 * the role, so a viewer simply sees no controls. `products` is the store's
 * catalogue, which each row opens to show the part of it the discount covers.
 */
export function DiscountsPage({
  summary,
  products,
  canWrite,
}: {
  summary: DiscountsSummary;
  products: readonly DiscountProductChoice[];
  canWrite: boolean;
}) {
  const t = useTranslations("Discounts");
  const toast = useToast();
  const showError = useActionErrorToast();
  const [pending, setPending] = useState<Pending>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  // Each discount's products, worked out once per data change rather than on
  // every keystroke of a confirm dialog.
  const covered = useMemo(
    () => new Map(summary.items.map((item) => [item.discount.id, coveredProducts(item.discount, products)])),
    [summary.items, products],
  );

  function run(id: string, action: () => Promise<DiscountActionResult>, done: string) {
    setBusyId(id);
    startTransition(async () => {
      const result = await action();
      setBusyId(null);
      setPending(null);
      if (result.ok) toast.success(done);
      else showError(result.error);
    });
  }

  if (summary.items.length === 0 && summary.orders === 0) {
    return <DiscountEmptyState canWrite={canWrite} />;
  }

  const pendingItem = pending ? summary.items.find((item) => item.discount.id === pending.id) : null;

  return (
    <div className="flex flex-col gap-8">
      {summary.orders > 0 && <DiscountPerformance summary={summary} />}

      <section className="flex flex-col gap-3" aria-labelledby="discount-list">
        <h2 id="discount-list" className="text-base font-semibold text-foreground">
          {t("list.title")}
        </h2>
        {summary.items.length === 0 ? (
          <p className={helpTextClass}>{t("list.none")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {summary.items.map((item) => (
              <DiscountRow
                key={item.discount.id}
                item={item}
                products={covered.get(item.discount.id) ?? []}
                canWrite={canWrite}
                busy={busyId === item.discount.id}
                onToggle={(enabled) =>
                  run(
                    item.discount.id,
                    () => setCodeEnabled(item.discount.id, enabled),
                    enabled ? t("toast.switchedOn") : t("toast.switchedOff"),
                  )
                }
                onEnd={() => setPending({ kind: "end", id: item.discount.id })}
                onDelete={() => setPending({ kind: "delete", id: item.discount.id })}
              />
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={pendingItem != null}
        onClose={() => {
          if (!busyId) setPending(null);
        }}
        tone="danger"
        // The ticket, with what is about to happen to it: stopped, or binned.
        visual={
          <HeroMark icon={Ticket} tone="danger" badge={pending?.kind === "end" ? TimerOff : Trash2} />
        }
        title={pending?.kind === "end" ? t("confirmEnd.title") : t("confirmDelete.title")}
        description={pending?.kind === "end" ? t("confirmEnd.body") : t("confirmDelete.body")}
        confirmLabel={pending?.kind === "end" ? t("confirmEnd.confirm") : t("confirmDelete.confirm")}
        pending={busyId !== null}
        onConfirm={() => {
          if (!pending) return;
          if (pending.kind === "end") run(pending.id, () => endSale(pending.id), t("toast.ended"));
          else run(pending.id, () => deleteDiscount(pending.id), t("toast.deleted"));
        }}
      />
    </div>
  );
}
