/**
 * Fixed consumer-law lines for EU sellers. Ours, not the seller's: a seller
 * cannot omit the right of withdrawal or the conformity guarantee from an
 * offer, so the page states them whatever the returns text says.
 */
export function StatutoryNotes({ isDigital }: { isDigital: boolean }) {
  return (
    <ul className="flex flex-col gap-1 text-xs opacity-70" data-product-statutory="">
      <li>
        You can cancel this purchase within 14 days of receiving it without giving a reason,
        unless one of the legal exceptions applies (for example made-to-order or sealed goods).
      </li>
      {isDigital && (
        <li>
          For a download, the right to cancel ends once you agree to start the download before
          the 14 days are over.
        </li>
      )}
      <li>EU law gives you at least a 2-year guarantee that goods conform to what was sold.</li>
    </ul>
  );
}
