"use client";

import Link from "next/link";
import { Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ShippingChoices } from "@/lib/storefront/queries";
import { Select, type SelectOption } from "@/components/ui/select";
import { helpTextClass, labelClass } from "@/components/ui/control-styles";

/**
 * WHICH SHIPPING TERMS THIS PRODUCT SHIPS UNDER — a choice, never a text box.
 *
 * The whole point of this section is that it does NOT ask a seller to write
 * shipping terms. Shipping reads the same for nearly every product in a
 * catalogue, so the terms live once on the ACCOUNT (Settings › Shipping &
 * returns) and every product inherits them; this field's default answer, and
 * its answer for nearly every product, is "the ones you already wrote".
 * Shopify and Etsy both landed on
 * the same shape — a general profile everything falls into, plus named
 * profiles for the exceptions — and for the same reason: fifty free-text
 * shipping boxes become fifty answers that drift apart.
 *
 * So the seller's job here is at most to pick from a list, and usually to read
 * the panel below it and move on. That panel is the other half of the point:
 * it shows the inherited terms in full, so "uses your store's terms" is
 * something you can check rather than something you have to trust.
 */

/** The select's value for "no profile", which is what the store default is. */
const DEFAULT_VALUE = "";

export function ShippingField({
  inputId,
  value,
  choices,
  onChange,
}: {
  inputId: string;
  /** The chosen profile id, or null for the store's default terms. */
  value: string | null;
  choices: ShippingChoices;
  onChange: (next: string | null) => void;
}) {
  const { profiles, fallback, editHref } = choices;
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

  const options: SelectOption<string>[] = [
    {
      value: DEFAULT_VALUE,
      label: "Your usual shipping terms",
      description: "Set once for your account. What almost every product wants.",
    },
    ...(orphaned
      ? [
          {
            value,
            label: "Removed profile",
            description: "This profile no longer exists, so buyers see your default terms.",
          },
        ]
      : []),
    ...profiles.map((profile) => ({
      value: profile.id,
      label: profile.name || "Untitled profile",
      description: firstLine(profile.body),
    })),
  ];

  const hasAnyTerms = profiles.length > 0 || Boolean(fallback.body || fallback.dispatch);

  return (
    <div
      className="space-y-4"
      data-product-field="shippingProfile"
      data-product-value={value ?? "default"}
    >
      {profiles.length > 0 || orphaned ? (
        <div className="space-y-1.5 sm:max-w-sm">
          <label htmlFor={inputId} className={labelClass}>
            Shipping profile
          </label>
          <Select
            id={inputId}
            value={value ?? DEFAULT_VALUE}
            options={options}
            onChange={(next) => onChange(next === DEFAULT_VALUE ? null : next)}
          />
        </div>
      ) : (
        <p className={helpTextClass}>
          Shipping terms are written once for your whole account, not per product, so this
          product uses them automatically.
        </p>
      )}

      {/* WHAT BUYERS WILL ACTUALLY READ. The words, not a promise of them:
          "uses your store's terms" is only reassuring if you can see which
          terms those are without leaving the form. */}
      {hasAnyTerms ? (
        <div className="rounded-md border border-border bg-muted/40 p-3">
          <div className="flex items-center gap-1.5 pb-2">
            <Truck className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="text-xs font-medium text-foreground">
              {chosen ? `On the product page: ${chosen.name}` : "On the product page"}
            </p>
          </div>
          {chosen ? (
            <Terms dispatch={chosen.dispatch} body={chosen.body} />
          ) : (
            <Terms
              dispatch={fallback.dispatch}
              body={fallback.body}
              empty="No shipping terms written yet."
            />
          )}
        </div>
      ) : (
        <p className={helpTextClass}>
          You have not written any shipping terms yet. Buyers see a note saying so.
        </p>
      )}

        <p className={helpTextClass}>
          <Link
            href={editHref}
            className="underline underline-offset-2 transition-colors duration-base ease-standard hover:text-foreground"
          >
            Edit your shipping terms
          </Link>{" "}
          {profiles.length > 0
            ? "— changes apply to every product using them."
            : "— or add a profile there for products that ship differently."}
        </p>
    </div>
  );
}

/** One set of terms, read-only. Paragraphs, exactly as the page prints them. */
function Terms({
  dispatch,
  body,
  empty,
}: {
  dispatch: string;
  body: string;
  empty?: string;
}) {
  if (!dispatch && !body) {
    return empty ? <p className={cn(helpTextClass, "italic")}>{empty}</p> : null;
  }
  return (
    <div className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
      {dispatch && <p className="font-medium text-foreground">{dispatch}</p>}
      {body && <p className="line-clamp-6 whitespace-pre-line">{body}</p>}
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
