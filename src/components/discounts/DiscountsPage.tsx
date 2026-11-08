"use client";

import { useMemo, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { Ticket, Trash2 } from "lucide-react";
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
import { DiscountRow } from "./DiscountRow";
import { EndSaleDialog } from "./EndSaleDialog";

/** The performance chart pulls in recharts, and only a page with orders needs
 *  it: loaded on demand, not on every visit to the discounts page. */
const DiscountPerformance = dynamic(
  () => import("./DiscountPerformance").then((module) => module.DiscountPerformance),
);

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
  // Cancel and Esc close a confirm, but not while its write is under way.
  const closePending = () => {
    if (!busyId) setPending(null);
  };

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

      <EndSaleDialog
        open={pending?.kind === "end" && pendingItem != null}
        pending={busyId !== null}
        onClose={closePending}
        onConfirm={() => {
          if (pending) run(pending.id, () => endSale(pending.id), t("toast.ended"));
        }}
      />
      <ConfirmDialog
        open={pending?.kind === "delete" && pendingItem != null}
        onClose={closePending}
        tone="danger"
        // The ticket, binned.
        visual={<HeroMark icon={Ticket} tone="danger" badge={Trash2} />}
        title={t("confirmDelete.title")}
        description={t("confirmDelete.body")}
        confirmLabel={t("confirmDelete.confirm")}
        pending={busyId !== null}
        onConfirm={() => {
          if (pending) run(pending.id, () => deleteDiscount(pending.id), t("toast.deleted"));
        }}
      />
    </div>
  );
}
