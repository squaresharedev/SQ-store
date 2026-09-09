// THE PUBLISH GATE. Which of a seller's trader details must be on file before
// anything of theirs may be published or sold, and the copy every surface uses
// to say so.
//
// WHY THIS IS A GATE AND NOT A NUDGE. A buyer entering a distance contract is
// entitled to know who they are contracting with and how to reach them before
// they are bound: under the EU Consumer Rights Directive (Art. 6(1)(b)-(c)) the
// trader's identity, geographic address and contact details have to be given
// with the offer, not on request afterwards. An offer published without them is
// not a slightly-incomplete offer, it is one the seller was not entitled to
// make. So this is enforced at every write that publishes and at every read
// that sells, rather than shown as a suggestion the seller can dismiss.
//
// PURE ON PURPOSE. No imports beyond the shared type: client components render
// the warning from this module, server actions and the public read gate decide
// from the same predicate, and there is exactly one answer to "is this seller
// allowed to sell" in the codebase. The service-role read that feeds it lives
// in ./seller-identity.ts (getTraderIdentityStatus), which is server-only.
//
// WHAT IS DELIBERATELY *NOT* REQUIRED:
//   - Phone. The Directive as amended asks for a telephone number, but the
//     field is account-level and many single-person sellers genuinely have no
//     business line; blocking on it would lock out sellers who are otherwise
//     fully contactable. It stays strongly recommended (the dashboard's
//     attention list asks for it) and is shown to buyers whenever it is set.
//   - Country. The picker lists EU member states only, so a seller outside the
//     EU cannot answer it truthfully. Requiring it would be a gate no non-EU
//     seller could pass.
//   - VAT ID. Only meaningful for a VAT-registered trader; requiring it would
//     be wrong for everyone else.

import type { StorefrontSeller } from "@/types/storefront";

/** The fields that block publishing while they are empty. */
export type TraderIdentityField = "businessName" | "address" | "email";

/** Where a seller fills these in. Every warning links here. */
export const TRADER_IDENTITY_HREF = "/settings/tax";

/**
 * Each required field, with the anchor on the settings page that lands on it
 * (see the `id`s on TaxSection's field wrappers) and the reason a buyer needs
 * it. The order is the order the settings form asks for them in, so a seller
 * working down the warning works down the page.
 */
export const TRADER_IDENTITY_FIELDS: readonly {
  key: TraderIdentityField;
  label: string;
  anchor: string;
  why: string;
}[] = [
  {
    key: "businessName",
    label: "Trader name",
    anchor: "business-name",
    why: "Buyers have to know who they are buying from — your business name, or your own full name if you sell as an individual.",
  },
  {
    key: "address",
    label: "Business address",
    anchor: "address",
    why: "A postal address has to appear with every offer under distance-selling law.",
  },
  {
    key: "email",
    label: "Contact email",
    anchor: "contact-email",
    why: "The address buyers write to about an order. It is also the buy button's fallback when a product has no purchase link.",
  },
] as const;

/** Deep link to the first thing a seller still has to fill in. */
export function traderIdentityHref(missing: readonly TraderIdentityField[]): string {
  const first = TRADER_IDENTITY_FIELDS.find((field) => missing.includes(field.key));
  return first ? `${TRADER_IDENTITY_HREF}#${first.anchor}` : TRADER_IDENTITY_HREF;
}

/**
 * Which required details this seller is still missing, in form order.
 *
 * `StorefrontSeller` only carries a member when the stored column was
 * non-empty (see buildSellerIdentity), so presence is the whole test — but the
 * values are trimmed and re-checked here anyway rather than trusting that,
 * because this decides whether something may go on sale.
 */
export function missingTraderIdentity(
  seller: StorefrontSeller,
): TraderIdentityField[] {
  return TRADER_IDENTITY_FIELDS.filter(
    (field) => !(seller[field.key] ?? "").trim(),
  ).map((field) => field.key);
}

/** True when this seller may publish and sell. */
export function isTraderIdentityComplete(seller: StorefrontSeller): boolean {
  return missingTraderIdentity(seller).length === 0;
}

/** "your trader name and contact email" — for use inside a sentence. */
export function listMissingTraderFields(
  missing: readonly TraderIdentityField[],
): string {
  const labels = TRADER_IDENTITY_FIELDS.filter((field) =>
    missing.includes(field.key),
  ).map((field) => field.label.toLowerCase());
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/**
 * The one sentence every surface leads with. Kept here so the storefront
 * editor, the product form, the dashboard banner and the server actions all
 * tell the seller the same thing.
 */
export const TRADER_IDENTITY_HEADLINE =
  "You can't publish or sell until your seller details are complete.";

/** The follow-up line, naming what is actually missing. */
export function traderIdentityFix(missing: readonly TraderIdentityField[]): string {
  const list = listMissingTraderFields(missing);
  return list
    ? `Add your ${list} in Settings › Business & seller details, then publish.`
    : "Complete Settings › Business & seller details, then publish.";
}
