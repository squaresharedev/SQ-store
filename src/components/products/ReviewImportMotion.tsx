import { cn } from "@/lib/utils";

/** A five-point star centred on 0,0, five units out. */
const STAR = "M0 -5L1.23 -1.7L4.76 -1.55L2 0.65L2.94 4.05L0 2.1L-2.94 4.05L-2 0.65L-4.76 -1.55L-1.23 -1.7Z";

/** Where the five stars land in the SquareShare window, centred on the drop. */
const STAR_XS = [224, 236, 248, 260, 272] as const;

/**
 * Decorative hero for the review import: a cursor picks up a review export
 * in another store's window, drags it across into SquareShare, and the
 * reviews land as five stars, looping.
 *
 * The other store is drawn generic (a window of product tiles), never a
 * brand's logo: the importer reads several apps' exports. Purely
 * presentational and `aria-hidden`; the page's copy carries the meaning.
 * Motion lives in globals.css (the review-move keyframes) and rests as a
 * static "imported" tableau under prefers-reduced-motion. Tokens only.
 */
export function ReviewImportMotion({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("relative h-36 w-full overflow-hidden rounded-md border border-border bg-secondary", className)}
    >
      <svg viewBox="0 0 320 128" className="absolute inset-0 size-full" fill="none">
        {/* The other store: a window of product tiles. */}
        <rect x="16" y="20" width="112" height="88" rx="6" className="fill-background stroke-border" />
        {[26, 33, 40].map((cx) => (
          <circle key={cx} cx={cx} cy="27" r="2" className="fill-foreground/15" />
        ))}
        {[26, 60, 94].map((x) => (
          <rect key={x} x={x} y="38" width="24" height="16" rx="2" className="fill-foreground/[0.06]" />
        ))}

        {/* SquareShare: the brand square in the title bar, and the drop. */}
        <rect x="192" y="20" width="112" height="88" rx="6" className="fill-background stroke-border" />
        <rect x="202" y="23" width="8" height="8" rx="2" className="fill-foreground" />
        <rect x="214" y="26" width="30" height="2" rx="1" className="fill-foreground/15" />
        <rect x="204" y="40" width="88" height="58" rx="4" strokeDasharray="3 3" className="stroke-foreground/20" />
        <rect x="204" y="40" width="88" height="58" rx="4" className="review-move-target fill-foreground/[0.04] stroke-foreground/60" />

        {/* The reviews, landing. Each star pops a beat after the last. */}
        {STAR_XS.map((x, index) => (
          <g key={x} transform={`translate(${x} 69)`}>
            <path
              d={STAR}
              className="review-move-star fill-foreground"
              style={{ animationDelay: `${index * 90}ms` }}
            />
          </g>
        ))}

        {/* The export: a sheet with a folded corner and a star on it. */}
        <g transform="translate(58 60)">
          <g className="review-move-file">
            <path
              d="M3 0H19L28 9V31A3 3 0 0 1 25 34H3A3 3 0 0 1 0 31V3A3 3 0 0 1 3 0Z"
              className="fill-background stroke-foreground"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <path d="M19 0V6A3 3 0 0 0 22 9H28" className="stroke-foreground" strokeWidth="1.5" strokeLinejoin="round" />
            <path d={STAR} transform="translate(14 17)" className="fill-foreground" />
            <rect x="7" y="25" width="14" height="2" rx="1" className="fill-foreground/30" />
          </g>
        </g>

        {/* The cursor, its tip on the sheet where it grabs it. */}
        <g transform="translate(78 80)">
          <path
            d="M0 0V15L4 11.5L6.8 17.5L9.2 16.4L6.5 10.6H11.5Z"
            className="review-move-cursor fill-foreground stroke-background"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </g>
      </svg>
    </div>
  );
}
