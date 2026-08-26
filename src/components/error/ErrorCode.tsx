/**
 * The status code as the page's hero: oversized digits sunk almost into the
 * background, with every `0` drawn as a ring in the accent colour.
 *
 * The ring is a drawn shape, not a glyph. No typeface renders a zero with a
 * square outside and a square counter, and that squareness is the house corner
 * (styles.md: square corners are the identity). It is a box with a thick
 * border, so its middle is genuinely transparent — the page shows through, and
 * the same markup is correct on a black surface and a white one.
 *
 * Pure markup and CSS. No client code, nothing to hydrate, which is what you
 * want on a page that only renders because something already went wrong.
 */
export function ErrorCode({ value }: { value: string }) {
  return (
    <div role="img" aria-label={value} className="error-code">
      {[...value].map((glyph, index) =>
        glyph === "0" ? (
          <span key={index} aria-hidden className="error-code-ring" />
        ) : (
          <span key={index} aria-hidden className="error-code-digit">
            {glyph}
          </span>
        ),
      )}
    </div>
  );
}
