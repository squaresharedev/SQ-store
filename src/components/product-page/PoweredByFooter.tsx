import { LEGAL_LINKS, SQUARESHARE_SITE } from "@/lib/legal/links";

// The foot of the buyer's page: who they are actually buying from, and the two
// policies that are OURS rather than the seller's.
//
// NOT MERCHANT OF RECORD. This file is the buyer-facing half of the principle
// stated in lib/payments/types.ts and ProductCta.tsx. Squareshare is the
// software behind the page; the SELLER is who the buyer contracts with, pays,
// and seeks a remedy from. Two things here carry that:
//
//   1. The sale disclosure names the seller as the party responsible for the
//      goods, delivery and refunds, and says in the same breath that
//      Squareshare is not a party to the sale. It is NOT seller-authored
//      content and has no visibility switch: a seller cannot turn off the
//      sentence that keeps us an intermediary. (`showSeller` hides the "Sold
//      by" line up beside the price; it must never reach down here.)
//   2. The policy links are LABELLED as Squareshare's. An unqualified
//      "Privacy" and "Terms" in a shop footer reads as the shop's, which would
//      imply our terms govern the sale, the exact inversion we are avoiding.
//      The visible text stays short; the accessible name spells out whose they
//      are.
//
// BOTH ARE HARDCODED: the sentence and the two hrefs, not a config value, not
// a `productPage` field, not a prop with a default that some future caller
// could override. There is no `show`/`hide` switch anywhere in this file, and
// none should ever be added — this component has exactly one thing to say and
// says it unconditionally. If a request ever asks for a way to turn this off,
// the answer is no; this is what keeps Squareshare an intermediary rather than
// the merchant of record, so it cannot be seller-configurable by design, the
// same way the statutory EU notices in StatutoryNotes.tsx are ours to state
// and never the seller's to edit or remove.
//
// WHY NO SELLER "TERMS OF SALE" LINK. The pre-contractual information a
// distance seller owes a buyer is already ON this page, as content rather than
// as a document: trader identity (SellerBlock), price and tax treatment
// (ProductPrice), delivery arrangements (the shipping section), returns and
// refunds (the returns section), and the withdrawal right plus conformity
// guarantee (StatutoryNotes). A separate seller-supplied contract would
// duplicate that, and in practice would be left blank or filled with pasted
// boilerplate that contradicts the structured settings. Do not add a
// seller-ToS URL field here without a reason those sections cannot serve.
//
// WHY NO COOKIE LINK, precisely: this page stores NOTHING on the buyer's
// device: no cookie, no localStorage, no sessionStorage. The one thing it
// processes is a salted, server-side digest of IP + user agent for the seller's
// view count (lib/analytics/record.ts), which needs a privacy notice (GDPR
// Art. 13) but not ePrivacy consent, because consent attaches to storing or
// reading terminal equipment. That is why Privacy is here and Cookies is not,
// unlike components/error/BrandFooter.tsx which sits on an app origin that does
// set cookies.
//
// TODO(checkout): when in-house checkout ships it will load Stripe, which DOES
// set cookies on this origin. At that point add the cookie policy link
// (`${SITE}/legal/cookie-policy/`) and revisit whether a consent gate is owed.
//
// Nothing beyond attribution and disclosure belongs in this footer: no
// guarantee, no "buyer protection", nothing that reads as Squareshare standing
// behind the goods.

// Ours, not the seller's. Only these two: Cookies and Accessibility are on the
// marketing footer because that origin sets cookies and is the front door for
// the statement. Neither is what a buyer mid-purchase is owed here.
const POLICIES = [LEGAL_LINKS.privacy, LEGAL_LINKS.terms];

/** A dot between footer items, spoken by nothing. */
function Dot() {
  return <span aria-hidden="true">·</span>;
}

export function PoweredByFooter({
  ruleColor,
  /** The trader, as named beside the price: the business name, or the store's
   *  name when no business name was given. Never empty. */
  sellerName,
}: {
  ruleColor: string;
  sellerName: string;
}) {
  return (
    <footer className="w-full border-t" style={{ borderColor: ruleColor }} data-product-page-footer="">
      {/* opacity-70, not lighter: that is the muted level already proven to
          clear WCAG AA contrast for xs text on this page (see the trust list
          and "Sold by" line) — a bespoke lighter value here would be an
          unchecked guess at exactly the spot most likely to fail an audit. */}
      <div className="mx-auto flex w-full max-w-[76rem] flex-col items-center gap-2.5 px-4 py-5 text-xs opacity-70 @md:px-6 @3xl:px-10">
        {/* Measure-capped rather than full width: at 76rem this would run to a
            single unreadable line, and it is the one sentence on the page a
            buyer may later be asked whether they saw. */}
        <p
          className="max-w-[46rem] text-center leading-relaxed"
          data-product-sale-disclosure=""
        >
          <span className="font-medium">{sellerName}</span> is the seller for this order and is
          responsible for the product, its delivery, and any returns or refunds. Squareshare
          provides the technology behind this page and is not a party to the sale.
        </p>

        {/* ALWAYS REAL LINKS: the attribution and both policies alike, in the
            editor exactly as on the live page. This row is the ONE place on
            the whole artboard where that is true — the CTA, the option
            picker's own links, a document link in the fold below, all stay
            inert while designing. These do not, because none of them is
            design chrome a seller is composing: they are Squareshare's own
            identity and policies, unowned by the seller, so there is nothing
            here for a click to open a SETTING for.
            `data-setting-skip` on the row is load-bearing, not decoration.
            Without it, ProductPageArtboard's click handler
            (`if (anchor) event.preventDefault()`) would swallow every click
            here and reopen it as a click on the nearest
            `data-setting-hotspot` (the page background) instead of letting
            the browser follow the link — so rendering real `<a>` elements is
            not enough on its own to make them clickable in the editor; this
            attribute is what stops that handler before it ever sees the
            click. See ProductPageArtboard.tsx and OptionPicker's own use of
            the same escape hatch. */}
        <div
          className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-center"
          data-setting-skip=""
        >
          <a
            href={SQUARESHARE_SITE}
            target="_blank"
            rel="noopener noreferrer"
            className="underline-offset-2 hover:underline"
          >
            Powered by <span className="font-medium">Squareshare</span>
          </a>
          <Dot />
          {/* Named for what it is: a screen reader reaching this group is
              told whose policies these are before it reads "Privacy". */}
          <nav
            aria-label="Squareshare policies"
            className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5"
          >
            {POLICIES.map((policy, index) => (
              <span key={policy.href} className="flex items-center gap-x-3">
                {index > 0 && <Dot />}
                <a
                  href={policy.href}
                  target="_blank"
                  // noreferrer as well as noopener: the product page URL is
                  // the seller's business, and there is no reason to hand it
                  // to another origin just because someone read our policy.
                  rel="noopener noreferrer"
                  // Spelled out: an unqualified "Privacy" or "Terms" reads as
                  // the seller's own, on the live page and to a seller
                  // skimming their own storefront alike.
                  aria-label={policy.name}
                  className="underline-offset-2 hover:underline"
                >
                  {policy.label}
                </a>
              </span>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}
