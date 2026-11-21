"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatCents } from "@/lib/format/money";
import { subtleFill } from "@/components/product-page/product-page-maps";
import { VersionChips } from "./VersionChips";
import type { CheckoutCart } from "@/types/checkout";

/**
 * A cart's other lines on its checkout, under the first (which the page shows
 * large): what each is, which version, how many, what it costs. Read only: the
 * lines change in the cart, one link away. The rows are the same as the "Add
 * to your order" lines' (CheckoutAddOns), so the two checkouts read alike.
 */
export function CheckoutCartLines({
  cart,
  ink,
  rule,
  cornerRadius,
  controlRadius,
  currency,
}: {
  cart: CheckoutCart;
  ink: string;
  rule: string;
  cornerRadius: number;
  controlRadius: number;
  currency: string;
}) {
  const t = useTranslations("ProductPage.cart");
  const locale = useLocale();
  const more = cart.lines.slice(1);
  return (
    <section className="flex flex-col gap-3 border-t pt-3" style={{ borderColor: rule }} data-checkout-cart-lines={cart.lines.length} data-setting-skip="">
      {more.length > 0 && (
        <ul className="flex flex-col gap-3">
          {more.map((line) => (
            <li key={`${line.productId}.${line.optionIds.join(".")}`} className="flex items-center gap-3" data-checkout-cart-line={line.productId}>
              <span
                className="size-12 shrink-0 overflow-hidden"
                style={{ borderRadius: controlRadius, background: subtleFill(ink) }}
                aria-hidden="true"
              >
                {line.photo && (
                  // eslint-disable-next-line @next/next/no-img-element -- a presigned R2 URL, like the product gallery's
                  <img src={line.photo.url} alt="" className="size-full object-cover" decoding="async" />
                )}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="truncate text-sm font-medium">
                  {line.quantity > 1 ? `${line.quantity} × ${line.title}` : line.title}
                </p>
                <VersionChips chips={line.chips} ink={ink} cornerRadius={cornerRadius} />
              </div>
              <p className="shrink-0 text-sm tabular-nums">{formatCents(line.unitCents * line.quantity, currency, locale)}</p>
            </li>
          ))}
        </ul>
      )}
      <a href={cart.editHref} className="self-start text-xs font-medium underline underline-offset-4" data-checkout-edit-cart="">
        {t("view")}
      </a>
    </section>
  );
}
