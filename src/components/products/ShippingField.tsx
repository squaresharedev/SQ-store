"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Info, Truck } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ShippingChoices } from "@/lib/storefront/queries";
import { SHIPPING_RATES_HREF, type SellerShippingPolicy } from "@/types/shipping-policy";
import type { Currency } from "@/types/product";
import { Select, type SelectOption } from "@/components/ui/select";
import { infoTextClass, labelClass } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";
import { canQuoteShipping } from "@/lib/shipping/rates";
import { STRIPE_CONNECT_AVAILABLE } from "@/lib/payments/availability";
import { ShippingTermsModal } from "./ShippingTermsModal";

/**
 * WHICH SHIPPING TERMS THIS PRODUCT SHIPS UNDER — a choice, never a text box.
 *
 * The whole point of this section is that it does NOT ask a seller to write
 * shipping terms. Shipping reads the same for nearly every product in a
 * catalogue, so the terms live once on the ACCOUNT (Settings › Shipping &
 * returns) and every product inherits them; this field's default answer, and
 * its answer for nearly every product, is "the ones you already wrote".
 * Shopify and Etsy both landed on the same shape — a general profile
 * everything falls into, plus named profiles for the exceptions — and for the
 * same reason: fifty free-text shipping boxes become fifty answers that
 * drift apart.
 *
 * So the seller's job here is at most to pick from a list, then glance at one
 * line to confirm what buyers will actually see. Editing those terms happens
 * in `ShippingTermsModal` — the same account-level form Settings › Shipping
 * uses, opened on top of this one rather than navigating away from it.
 *
 * AND ONE THING IT SAYS UNASKED: when delivery has no price in this product's
 * currency, checkout cannot show a total, so the product page has no Pay
 * button (lib/checkout/availability.ts). Nothing else on screen would tell the
 * seller why. Only where buyers can pay through checkout at all.
 */

/** The select's value for "no profile", which is what the store default is. */
const DEFAULT_VALUE = "";

export function ShippingField({
  inputId,
  value,
  choices,
  policy,
  currency,
  onChange,
}: {
  inputId: string;
  /** The product's currency: delivery has to be priced in the same one. */
  currency: Currency;
  /** The chosen profile id, or null for the store's default terms. */
  value: string | null;
  choices: ShippingChoices;
  /** The full, editable policy document — only used to seed the modal. */
  policy: SellerShippingPolicy;
  onChange: (next: string | null) => void;
}) {
  const t = useTranslations("Products.shippingField");
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const { profiles, fallback } = choices;
  // No store name on any row any more: there is ONE set of terms for the
  // account, so there is no second store to tell a profile apart from.

  const chosen = profiles.find((profile) => profile.id === value) ?? null;
  // A stored id that matches nothing, which now has exactly one cause: the
  // seller deleted the profile. (It used to have a second — a product placed
  // on a storefront that never had that profile — which the move to
  // account-level terms removed outright.) The product page already
  // falls back to the default, so this row is only telling the seller
  // what is ALREADY true — and it keeps the stored value untouched, so simply
  // opening the form does not count as an edit.
  const orphaned = value !== null && chosen === null;
  const unpriced = STRIPE_CONNECT_AVAILABLE && !canQuoteShipping(policy, currency);

  const options: SelectOption<string>[] = [
    {
      value: DEFAULT_VALUE,
      label: t("usual"),
      description: t("usualDescription"),
    },
    ...(orphaned
      ? [
          {
            value,
            label: t("removed"),
            description: t("removedDescription"),
          },
        ]
      : []),
    ...profiles.map((profile) => ({
      value: profile.id,
      label: profile.name || t("untitled"),
      description: firstLine(profile.body),
    })),
  ];

  // ONE LINE, not a paragraph: dispatch time first (the fact a buyer scans
  // for), falling back to the opening of the free-text terms, falling back to
  // an honest "nothing written yet" rather than silence.
  const summary = chosen
    ? chosen.dispatch || firstLine(chosen.body) || t("profileNoTerms")
    : fallback.dispatch || firstLine(fallback.body) || t("noTerms");

  return (
    <div
      className="space-y-3"
      data-product-field="shippingProfile"
      data-product-value={value ?? "default"}
    >
      {(profiles.length > 0 || orphaned) && (
        <div className="space-y-1.5 sm:max-w-sm">
          <label htmlFor={inputId} className={labelClass}>
            {t("profile")}
          </label>
          <Select
            id={inputId}
            value={value ?? DEFAULT_VALUE}
            options={options}
            onChange={(next) => onChange(next === DEFAULT_VALUE ? null : next)}
          />
        </div>
      )}

      {/* THE ONE LINE A SELLER ACTUALLY SCANS FOR: what buyers will read,
          without leaving the form to find out. Full terms — and editing them
          — are one click away in the modal, not repeated here. */}
      <div className="flex items-center justify-between gap-3 border border-border bg-muted/40 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Truck className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="truncate text-xs text-foreground">{summary}</p>
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="shrink-0 font-inter text-xs font-medium text-muted-foreground underline underline-offset-2 transition-colors duration-base ease-standard hover:text-foreground motion-reduce:transition-none"
        >
          {t("edit")}
        </button>
      </div>

      {unpriced && (
        <p className={cn(infoTextClass, "flex items-start gap-1.5")} data-product-delivery-unpriced="">
          <Info className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
          <span>
            {t("unpriced", { currency })}{" "}
            <Link href={SHIPPING_RATES_HREF} className="font-medium text-foreground underline underline-offset-2">
              {t("unpricedAction")}
            </Link>
          </span>
        </p>
      )}

      <ShippingTermsModal
        open={editing}
        onClose={() => {
          setEditing(false);
          // Picks up whatever was just saved (or not) without disturbing the
          // rest of this form's in-memory state — see ShippingTermsModal.
          router.refresh();
        }}
        policy={policy}
      />
    </div>
  );
}

/** The opening of a profile's terms, for the picker's second line. */
function firstLine(body: string): string | undefined {
  const line = body.split(/\r?\n/).find((entry) => entry.trim() !== "");
  if (!line) return undefined;
  const trimmed = line.trim();
  return trimmed.length > 80 ? `${trimmed.slice(0, 79)}…` : trimmed;
}
