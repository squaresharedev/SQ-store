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
// PURE ON PURPOSE. No imports beyond the shared types: client components render
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

import { msg, type MessageKey, type MessageRef } from "@/i18n/types";
import type { StorefrontSeller } from "@/types/storefront";

/** The fields that block publishing while they are empty. */
export type TraderIdentityField =
  | "businessName"
  | "address"
  | "email"
  | "emailVerified";

/**
 * What the gate is asked about: the buyer-facing identity, plus whether the
 * contact address has actually been proven.
 *
 * `emailVerified` is separate from the identity itself because it is NOT
 * something a buyer sees — it is a fact about the account, and letting it into
 * `StorefrontSeller` would put it one careless spread away from a product page.
 */
export type TraderIdentityInput = StorefrontSeller & {
  emailVerified?: boolean;
};

/** Where a seller fills these in. Every warning links here. */
export const TRADER_IDENTITY_HREF = "/settings/tax";

/**
 * Each required field, with the anchor on the settings page that lands on it
 * (see the `id`s on TaxSection's field wrappers) and the reason a buyer needs
 * it. The order is the order the settings form asks for them in, so a seller
 * working down the warning works down the page. `label` and `why` are message
 * keys, resolved where they render.
 */
export const TRADER_IDENTITY_FIELDS: readonly {
  key: TraderIdentityField;
  label: MessageKey;
  anchor: string;
  why: MessageKey;
}[] = [
  {
    key: "businessName",
    label: "Settings.sellerDetails.fields.businessName.label",
    anchor: "business-name",
    why: "Settings.sellerDetails.fields.businessName.why",
  },
  {
    key: "address",
    label: "Settings.sellerDetails.fields.address.label",
    anchor: "address",
    why: "Settings.sellerDetails.fields.address.why",
  },
  {
    key: "email",
    label: "Settings.sellerDetails.fields.email.label",
    anchor: "contact-email",
    why: "Settings.sellerDetails.fields.email.why",
  },
  {
    key: "emailVerified",
    label: "Settings.sellerDetails.fields.emailVerified.label",
    anchor: "contact-email",
    why: "Settings.sellerDetails.fields.emailVerified.why",
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
  seller: TraderIdentityInput,
  options: {
    /**
     * Also require the contact address to have been PROVEN by a clicked link.
     * The caller decides, because a deployment that cannot send mail must not
     * demand one — see lib/settings/seller-email-verification.ts.
     */
    requireVerifiedEmail?: boolean;
  } = {},
): TraderIdentityField[] {
  const missing: TraderIdentityField[] = [];
  for (const field of TRADER_IDENTITY_FIELDS) {
    if (field.key === "emailVerified") {
      // Only worth saying when there IS an address to confirm: telling a
      // seller with no contact email that it is also unconfirmed is two
      // complaints about one blank field.
      if (
        options.requireVerifiedEmail &&
        (seller.email ?? "").trim() &&
        !seller.emailVerified
      ) {
        missing.push(field.key);
      }
      continue;
    }
    if (!(seller[field.key] ?? "").trim()) missing.push(field.key);
  }
  return missing;
}

/** True when this seller may publish and sell. */
export function isTraderIdentityComplete(
  seller: TraderIdentityInput,
  options: { requireVerifiedEmail?: boolean } = {},
): boolean {
  return missingTraderIdentity(seller, options).length === 0;
}

/**
 * The one sentence every surface leads with. Kept here so the storefront
 * editor, the product form, the dashboard banner and the server actions all
 * tell the seller the same thing.
 */
export const TRADER_IDENTITY_HEADLINE: MessageRef = msg("Errors.traderIdentityRequired.message");

/** The fields a seller types, in the order the settings form asks for them. */
const TYPED_TRADER_FIELDS = ["businessName", "address", "email"] as const;

/**
 * The follow-up line, naming what is actually missing. The missing set goes in
 * as one DATA value ("businessName_email") that the message selects on, so
 * each combination is a whole sentence a translator controls, rather than a
 * list of translated labels joined with an English "and".
 *
 * An unconfirmed address gets its own sentence: "add your confirmed contact
 * email" would be advice to type something, and the thing to do is click a
 * link that has already been sent.
 */
export function traderIdentityFix(missing: readonly TraderIdentityField[]): MessageRef {
  const typed = TYPED_TRADER_FIELDS.filter((field) => missing.includes(field));
  const confirm = missing.includes("emailVerified");
  const fields = typed.join("_");

  if (typed.length > 0 && confirm) {
    return msg("Errors.traderIdentityRequired.fix.addAndConfirm", { fields });
  }
  if (confirm) return msg("Errors.traderIdentityRequired.fix.confirm");
  return typed.length > 0
    ? msg("Errors.traderIdentityRequired.fix.add", { fields })
    : msg("Errors.traderIdentityRequired.fix.complete");
}
