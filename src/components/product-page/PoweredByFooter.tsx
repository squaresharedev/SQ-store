// The one place this page says who BUILT it, not who is selling on it.
//
// Deliberately small and last on the page: the seller's identity is what a
// buyer reads first and most (the header bar, "Sold by", the Seller section),
// and this line exists only so a buyer can always tell that Squareshare is
// the software behind the page, never the trader they are buying from. This
// is load-bearing for staying an intermediary rather than the Merchant of
// Record: the seller is who the buyer contracts with, pays, and seeks a
// remedy from, and this page must never blur that. No claim beyond
// attribution belongs here — no guarantee, no "buyer protection", nothing
// that reads as Squareshare being a party to the sale.

const SQUARESHARE_URL = "https://squareshare.eu";

export function PoweredByFooter({
  ruleColor,
  /** Editor preview: plain text, like every other link on this page — the
   *  artboard is for designing, not for navigating away from the editor. */
  preview,
}: {
  ruleColor: string;
  preview: boolean;
}) {
  const label = (
    <>
      Powered by <span className="font-medium">Squareshare</span>
    </>
  );
  return (
    <footer className="w-full border-t" style={{ borderColor: ruleColor }} data-product-page-footer="">
      {/* opacity-70, not lighter: that is the muted level already proven to
          clear WCAG AA contrast for xs text on this page (see the trust list
          and "Sold by" line) — a bespoke lighter value here would be an
          unchecked guess at exactly the spot most likely to fail an audit. */}
      <p className="mx-auto w-full max-w-[76rem] px-4 py-4 text-center text-xs opacity-70 @md:px-6 @3xl:px-10">
        {preview ? (
          label
        ) : (
          <a
            href={SQUARESHARE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline-offset-2 hover:underline"
          >
            {label}
          </a>
        )}
      </p>
    </footer>
  );
}
