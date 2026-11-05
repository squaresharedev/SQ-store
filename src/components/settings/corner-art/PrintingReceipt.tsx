import type { CSSProperties } from "react";
import { CornerArt } from "@/components/ui/CornerArt";

const WIDTH = 170;
const HEIGHT = 100;
/** The paper's left edge and width, clear of the card's right edge. */
const PAPER_X = 46;
const PAPER_WIDTH = 88;
/** Where its torn edge ends, and the teeth along it. */
const PAPER_END = 80;
const TOOTH = 8;
const TOOTH_DEPTH = 4;
/** The printer's slot: the card's top edge, a dark lip across it a little
 *  wider than the paper. */
const SLOT_LIP = 4;
const SLOT_OVERHANG = 8;
/** One print, a look at it, a tear, and a pause. */
const LOOP_MS = 5200;

/** The paper: straight sides up into the slot, and a torn, toothed end. */
const PAPER =
  `M 0 ${-SLOT_LIP * 3} V ${PAPER_END} ` +
  Array.from(
    { length: PAPER_WIDTH / TOOTH },
    (_, tooth) =>
      `L ${tooth * TOOTH + TOOTH / 2} ${PAPER_END + TOOTH_DEPTH} L ${(tooth + 1) * TOOTH} ${PAPER_END}`,
  ).join(" ") +
  ` V ${-SLOT_LIP * 3} Z`;

/** What it prints, as bars: a heading, three lines with their amounts, a
 *  rule, the total in bold, a sign-off. In paper coordinates. */
const HEADING = { x: 28, y: 10, width: 32, height: 5 };
const ITEMS = [34, 26, 40].map((width, index) => ({ y: 24 + index * 10, width }));
const RULE_Y = 54;
const TOTAL_Y = 62;
const SIGN_OFF = { x: 30, y: 72, width: 28 };
const MARGIN = 10;
const AMOUNT_X = 64;

/**
 * A RECEIPT PRINTING, for plan and billing: paper feeds down out of the card's
 * top edge a line at a time, the way a till prints, with its items, a rule
 * and a bold total. It is held a moment, torn off and falls away, and the
 * next one starts.
 */
export function PrintingReceipt({ className }: { className?: string }) {
  return (
    <CornerArt
      name="printing-receipt"
      width={WIDTH}
      height={HEIGHT}
      className={className}
      style={
        {
          "--corner-loop": `${LOOP_MS}ms`,
          "--receipt-hide": `${-(PAPER_END + TOOTH_DEPTH + SLOT_LIP * 3)}px`,
        } as CSSProperties
      }
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width={WIDTH}
        height={HEIGHT}
        className="absolute inset-0"
      >
        <g
          className="corner-receipt"
          style={{ transformBox: "view-box", transformOrigin: `${PAPER_X + PAPER_WIDTH / 2}px 0px` }}
        >
          <g transform={`translate(${PAPER_X} 0)`}>
            <path
              d={PAPER}
              className="fill-background stroke-foreground"
              strokeWidth={2.5}
              strokeLinejoin="round"
            />
            <rect {...HEADING} rx={HEADING.height / 2} className="fill-foreground" />
            {ITEMS.map(({ y, width }) => (
              <g key={y} className="fill-muted-foreground">
                <rect x={MARGIN} y={y} width={width} height={3} rx={1.5} />
                <rect x={AMOUNT_X} y={y} width={PAPER_WIDTH - MARGIN - AMOUNT_X} height={3} rx={1.5} />
              </g>
            ))}
            <path
              d={`M ${MARGIN} ${RULE_Y} H ${PAPER_WIDTH - MARGIN}`}
              className="stroke-muted-foreground"
              strokeWidth={2}
              strokeDasharray="3 3"
            />
            <g className="fill-foreground">
              <rect x={MARGIN} y={TOTAL_Y} width={26} height={5} rx={2.5} />
              <rect x={PAPER_WIDTH - MARGIN - 22} y={TOTAL_Y} width={22} height={5} rx={2.5} />
            </g>
            <rect {...SIGN_OFF} height={2.5} rx={1.25} className="fill-muted-foreground" />
          </g>
        </g>
        <rect
          x={PAPER_X - SLOT_OVERHANG}
          y={-SLOT_LIP * 2}
          width={PAPER_WIDTH + SLOT_OVERHANG * 2}
          height={SLOT_LIP * 3}
          rx={SLOT_LIP}
          className="fill-foreground"
        />
      </svg>
    </CornerArt>
  );
}
