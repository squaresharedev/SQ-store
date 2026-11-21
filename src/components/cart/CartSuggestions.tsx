"use client";

import { useId, useState } from "react";
import { Check, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { formatCents } from "@/lib/format/money";
import { ProductThumb } from "@/components/ui/ProductThumb";
import { Spinner } from "@/components/ui/spinner";
import type { CartSuggestion } from "@/types/cart";
import { useCart } from "./CartContext";
import type { CartPanelTheme } from "./CartPanel";

/** A suggestion's one control: a quiet outlined button in the panel's ink,
 *  whatever the shop's buy button looks like (the cart's checkout button is
 *  the one primary control here). */
const SUGGESTION_BUTTON_CLASS =
  "inline-flex min-h-8 items-center justify-center gap-1 border border-current px-2.5 text-xs font-semibold transition-opacity duration-base ease-standard hover:opacity-70 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

/**
 * "GOES WELL WITH", under the cart's lines: the products the seller picked for
 * "Add to your order" on what is in the cart (lib/cart/suggestions.ts). One
 * press puts one in where it needs no choice; one with versions opens its
 * page. A suggestion leaves the list once it is in the cart (the server's
 * next view leaves it out). Drawn as small cards or as a list (the cart
 * look); in the panel's own ink, on the page's corners.
 */
export function CartSuggestions({ theme }: { theme: CartPanelTheme }) {
  const t = useTranslations("ProductPage.cart");
  const locale = useLocale();
  const cart = useCart();
  const heading = useId();
  const [busy, setBusy] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  if (!cart?.view || cart.config.suggestions === false || cart.view.suggestions.length === 0) return null;
  const { view, look } = cart;
  const money = (cents: number) => formatCents(cents, view.currency ?? "EUR", locale);
  const corners = { borderRadius: `${theme.cornerRadius}px` };

  async function add(item: CartSuggestion) {
    if (!cart || !item.quickAdd || busy || cart.preview) return;
    setBusy(item.productId);
    const result = await cart.add({
      productId: item.productId,
      optionIds: item.quickAdd.optionIds,
      quantity: 1,
      source: "cart",
      title: item.title,
    });
    setBusy(null);
    if (result.ok) setAdded(item.productId);
  }

  function control(item: CartSuggestion) {
    if (!item.quickAdd) {
      return (
        <a
          href={cart?.preview ? undefined : item.href}
          className={SUGGESTION_BUTTON_CLASS}
          style={{ ...corners, outlineColor: theme.ink }}
          data-cart-suggestion-choose=""
        >
          {t("choose")}
        </a>
      );
    }
    const working = busy === item.productId;
    return (
      <button
        type="button"
        onClick={() => void add(item)}
        disabled={working}
        aria-label={t("addTitle", { title: item.title })}
        className={SUGGESTION_BUTTON_CLASS}
        style={{ ...corners, outlineColor: theme.ink }}
        data-cart-suggestion-add=""
      >
        {working ? (
          <Spinner className="size-3.5" />
        ) : added === item.productId ? (
          <Check className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
        ) : (
          <Plus className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
        )}
        {look.suggestions === "cards" && <span>{t("addShort")}</span>}
      </button>
    );
  }

  function price(item: CartSuggestion) {
    return (
      <p className="text-xs tabular-nums">
        <span className="font-semibold">{money(item.unitCents)}</span>
        {item.regularUnitCents !== null && (
          <s className="ml-1 text-muted-foreground">{money(item.regularUnitCents)}</s>
        )}
      </p>
    );
  }

  return (
    <section className="mt-4 flex flex-col gap-3 border-t border-border pt-4" aria-labelledby={heading} data-cart-suggestions={look.suggestions}>
      <h3 id={heading} className="text-sm font-semibold">
        {t("suggestionsTitle")}
      </h3>
      {look.suggestions === "cards" ? (
        <ul className="grid grid-cols-3 gap-3">
          {view.suggestions.map((item) => (
            <li key={item.productId} className="flex min-w-0 flex-col gap-1.5" data-cart-suggestion={item.productId}>
              <div style={corners} className="overflow-hidden">
                <ProductThumb src={item.image?.url} className="aspect-square h-auto w-full rounded-none" />
              </div>
              <p className="line-clamp-2 text-xs font-medium">{item.title}</p>
              {price(item)}
              {control(item)}
            </li>
          ))}
        </ul>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {view.suggestions.map((item) => (
            <li key={item.productId} className="flex items-center gap-3 py-2" data-cart-suggestion={item.productId}>
              <div style={corners} className="shrink-0 overflow-hidden">
                <ProductThumb src={item.image?.url} className="size-10 rounded-none" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="truncate text-sm font-medium">{item.title}</p>
                {price(item)}
              </div>
              {control(item)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
