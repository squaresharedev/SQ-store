import type { CheckoutCelebration, CheckoutLayout } from "@/types/storefront";
import { optionGlyphFrameClass } from "./OptionCardPicker";

/**
 * The checkout panel's choices as pictures of themselves, for OptionCardPicker:
 * a seller sees the arrangement and the celebration instead of reading a
 * description of each.
 */

/** Frame shared by every checkout glyph: a small landscape page. */
const PAGE_FRAME = `flex h-10 w-14 ${optionGlyphFrameClass}`;

/** Showcase: the product large on one side, the form beside it. Compact: one
 *  calm column with the summary on top. */
export function ArrangementGlyph({ layout }: { layout: CheckoutLayout }) {
  const form = (
    <>
      <span className="h-1 w-full rounded-full bg-foreground/60" />
      <span className="h-1 w-3/4 rounded-full bg-foreground/30" />
      <span className="h-1.5 w-full rounded-full bg-foreground/80" />
    </>
  );
  if (layout === "showcase") {
    return (
      <span aria-hidden="true" className={PAGE_FRAME}>
        <span className="flex w-1/2 items-center justify-center bg-muted">
          <span className="size-3.5 rounded-xs bg-foreground/25" />
        </span>
        <span className="flex flex-1 flex-col justify-center gap-1 px-1.5">{form}</span>
      </span>
    );
  }
  return (
    <span aria-hidden="true" className={`${PAGE_FRAME} justify-center`}>
      <span className="flex w-6 flex-col justify-center gap-1">
        <span className="h-2 w-full rounded-xs border border-foreground/30" />
        {form}
      </span>
    </span>
  );
}

/** Confetti pieces as [x, y, rotation] on the glyph's 40 x 28 drawing. */
const CONFETTI: readonly (readonly [number, number, number])[] = [
  [6, 5, 30],
  [13, 3, -20],
  [27, 4, 45],
  [34, 8, -35],
  [9, 12, 60],
  [31, 14, 15],
  [4, 21, -45],
  [36, 22, 30],
];
const RAY_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

/** The thank-you's check mark, and what plays around it. */
export function CelebrationGlyph({ kind }: { kind: CheckoutCelebration }) {
  return (
    <span aria-hidden="true" className={`${PAGE_FRAME} items-center justify-center`}>
      <svg viewBox="0 0 40 28" className="h-full w-full text-foreground">
        {kind === "confetti" &&
          CONFETTI.map(([x, y, rotate]) => (
            <rect
              key={`${x}-${y}`}
              x={x}
              y={y}
              width={3}
              height={1.4}
              rx={0.5}
              fill="currentColor"
              opacity={0.55}
              transform={`rotate(${rotate} ${x + 1.5} ${y + 0.7})`}
            />
          ))}
        {kind === "rays" &&
          RAY_ANGLES.map((angle) => {
            const radians = (angle * Math.PI) / 180;
            return (
              <line
                key={angle}
                x1={20 + Math.cos(radians) * 8}
                y1={15 + Math.sin(radians) * 8}
                x2={20 + Math.cos(radians) * 13}
                y2={15 + Math.sin(radians) * 13}
                stroke="currentColor"
                strokeWidth={1.2}
                strokeLinecap="round"
                opacity={0.4}
              />
            );
          })}
        <circle cx={20} cy={15} r={5} fill="currentColor" opacity={0.8} />
        <path
          d="M17.8 15.2 L19.4 16.7 L22.3 13.6"
          fill="none"
          stroke="var(--background)"
          strokeWidth={1.3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
