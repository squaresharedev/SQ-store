/**
 * Squareshare's OWN policy pages: the canonical hrefs, in one place.
 *
 * WHY A MODULE FOR FOUR STRINGS. These are the links a regulator follows and
 * the links a buyer is entitled to reach. They were already written out twice
 * (components/error/BrandFooter.tsx and app/global-error.tsx) and the buyer's
 * product footer made three; the failure mode of a duplicated legal URL is not
 * a 404, it is one surface quietly pointing at a policy that has moved while
 * the others point at the live one. Import from here instead of retyping.
 *
 * THE PAGES LIVE ON THE MARKETING ORIGIN, not this one: this app is a
 * subdomain and has no /terms of its own. So every href is absolute, and every
 * consumer renders a plain <a>, never next/link.
 *
 * EVERY HREF ENDS IN A SLASH. The marketing site is built with
 * `trailingSlash: true` (Home's next.config.ts), so the slashless form is a
 * 308 to the slashed one. Verified live: /terms 308s to /terms/, and so does
 * /accessibility and /legal/cookie-policy. Writing the canonical form costs a
 * buyer one less round trip on a link they are clicking mid-purchase. The
 * bare site root is the exception: it 200s as-is.
 *
 * DELIBERATELY IMPORT-FREE. app/global-error.tsx is the last-resort boundary
 * for a crash in the root layout and keeps its own copy on purpose (it must
 * not depend on anything that could itself be what failed), but if this file
 * ever grows an import, that reasoning gets worse for every other consumer
 * too. Keep it plain data.
 *
 * WHOSE POLICIES THESE ARE MATTERS. On a seller's storefront these are the
 * PLATFORM's terms, not the shop's, and they do not govern the sale. See the
 * disclosure in components/product-page/PoweredByFooter.tsx. Anything
 * rendering these next to a seller's own content has to say so.
 */
export const SQUARESHARE_SITE = "https://squareshare.eu";

export const LEGAL_LINKS = {
  privacy: {
    label: "Privacy",
    /** Spelled out for use as an accessible name where "Privacy" alone would
     *  read as the seller's own policy. */
    name: "Squareshare Privacy Policy",
    href: `${SQUARESHARE_SITE}/legal/privacy-policy/`,
  },
  cookies: {
    label: "Cookies",
    name: "Squareshare Cookie Policy",
    href: `${SQUARESHARE_SITE}/legal/cookie-policy/`,
  },
  terms: {
    label: "Terms",
    name: "Squareshare Terms of Use",
    href: `${SQUARESHARE_SITE}/terms/`,
  },
  accessibility: {
    label: "Accessibility",
    name: "Squareshare Accessibility Statement",
    href: `${SQUARESHARE_SITE}/accessibility/`,
  },
} as const;

export type LegalLink = (typeof LEGAL_LINKS)[keyof typeof LEGAL_LINKS];
