"use client";

import { useState } from "react";
import { AlertCircle, Minus, Plus, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/format/money";
import { ProductThumb } from "@/components/ui/ProductThumb";
import { overlayCloseButtonClass } from "@/components/ui/control-styles";
import { PageSelect } from "@/components/product-page/PageSelect";
import type { CartLineView } from "@/types/cart";
import type { CartRowStyle, CartStepper } from "./cart-look";

/** The photo's size per row style; the ledger draws none. */
const THUMB_CLASS: Record<CartRowStyle, string> = {
  photo: "size-16",
  compact: "size-10",
  ledger: "hidden",
};

/** A quantity control's square: a thumb target on a phone, quieter beside. */
const STEP_CLASS =
  "flex size-8 items-center justify-center transition-opacity duration-base ease-standard hover:opacity-70 disabled:pointer-events-none disabled:opacity-30 focus-visible:outline focus-visible:outline-2";

/**
 * ONE LINE IN THE CART: what it is, which version, how many, what it costs,
 * and why it cannot be bought when it cannot (never removed for the buyer:
 * they see it and take it out themselves). Drawn in the panel's own ink (the
 * shop's, through the overlay's colour variables).
 */
export function CartLineRow({
  line,
  currency,
  rows,
  stepper,
  cornerRadius,
  ink,
  busy,
  onQuantity,
  onRemove,
}: {
  line: CartLineView;
  currency: string;
  rows: CartRowStyle;
  stepper: CartStepper;
  cornerRadius: number;
  /** The panel's ink, for the quantity list. */
  ink: string;
  /** A change to this line is on its way. */
  busy: boolean;
  onQuantity: (quantity: number) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("ProductPage.cart");
  const locale = useLocale();
  const money = (cents: number) => formatCents(cents, currency, locale);
  const title = line.title ?? t("gone");
  // The stepper offers up to the PUBLIC limit, and never less than what the
  // line already holds (so a buyer can always come down from it).
  const ceiling = Math.max(line.quantity, line.maxQuantity);
  const canChange = line.title !== null && line.problem !== "not_found";
  const [stepping, setStepping] = useState(false);

  function step(next: number) {
    if (next < 1 || next > ceiling || next === line.quantity) return;
    setStepping(true);
    onQuantity(next);
    setStepping(false);
  }

  return (
    <li
      className={cn("flex gap-3", rows === "compact" ? "items-center py-2" : "py-3", busy && "opacity-60")}
      data-cart-line={line.key}
      data-cart-problem={line.problem ?? undefined}
    >
      {rows !== "ledger" && (
        <div style={{ borderRadius: `${cornerRadius}px` }} className="shrink-0 overflow-hidden">
          <ProductThumb src={line.image?.url} className={cn(THUMB_CLASS[rows], "rounded-none")} />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {line.href && canChange ? (
              <a href={line.href} className="line-clamp-2 text-sm font-medium hover:underline">
                {title}
              </a>
            ) : (
              <p className="line-clamp-2 text-sm font-medium">{title}</p>
            )}
            {line.selection.length > 0 && (
              <p className="truncate text-xs text-muted-foreground">
                {line.selection.map((row) => row.value).join(", ")}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            aria-label={t("remove", { title })}
            className={cn(overlayCloseButtonClass, "-mr-1.5 -mt-1 size-8")}
            data-cart-remove=""
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        {line.problem && (
          <p className="flex items-start gap-1.5 text-xs font-medium" role="note" data-cart-line-problem={line.problem}>
            <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            {t(`problem.${line.problem}`)}
          </p>
        )}

        <div className="flex items-center justify-between gap-3">
          {canChange ? (
            stepper === "buttons" ? (
              <div
                className="inline-flex items-center border border-border"
                style={{ borderRadius: `${cornerRadius}px` }}
                role="group"
                aria-label={t("quantity", { title })}
              >
                <button
                  type="button"
                  className={STEP_CLASS}
                  onClick={() => step(line.quantity - 1)}
                  disabled={busy || stepping || line.quantity <= 1}
                  aria-label={t("fewer", { title })}
                >
                  <Minus className="size-3.5" aria-hidden="true" />
                </button>
                <span className="min-w-6 text-center text-sm tabular-nums" aria-live="polite" data-cart-quantity="">
                  {line.quantity}
                </span>
                <button
                  type="button"
                  className={STEP_CLASS}
                  onClick={() => step(line.quantity + 1)}
                  disabled={busy || stepping || line.quantity >= ceiling}
                  aria-label={t("more", { title })}
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            ) : (
              // The shared listbox, never a native <select>: an OS option list
              // ignores the shop's ink and draws white on white on a dark shop.
              <PageSelect
                label={t("quantity", { title })}
                value={String(line.quantity)}
                options={Array.from({ length: Math.min(ceiling, 99) }, (_, index) => ({
                  value: String(index + 1),
                  label: String(index + 1),
                }))}
                onChange={(value) => step(Number(value))}
                radius={cornerRadius}
                ink={ink}
                className="w-20"
              />
            )
          ) : (
            <span />
          )}
          {line.unitCents !== null && (
            <span className="flex items-baseline gap-1.5 text-sm tabular-nums" data-cart-amount={line.amountCents ?? undefined}>
              {line.regularUnitCents !== null && (
                <s className="text-xs text-muted-foreground">{money(line.regularUnitCents * line.quantity)}</s>
              )}
              {/* A line that cannot be bought is not in the subtotal: its
                  price is shown quieter, so the sum still reads right. */}
              <span className={cn("font-medium", line.problem && "text-muted-foreground")}>
                {money(line.amountCents ?? line.unitCents * line.quantity)}
              </span>
            </span>
          )}
        </div>
      </div>
    </li>
  );
}
