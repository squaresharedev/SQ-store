import { motion, type Variants } from "motion/react";
import { IconSvg } from "./IconSvg";
import { EASE_ENTRANCE, SETTLE } from "./motion-tokens";
import type { NavIconProps } from "./types";

/**
 * Products: the box opens, all four lids swinging outward.
 *
 * The lid is a rhombus with corners back(12,2), left(3.29,7), front(12,12)
 * and right(20.71,7), and one lid hangs off each of its four edges. A lid
 * turning out of that plane keeps its free edge parallel to its hinge, so the
 * offset from hinge to free edge is cos(angle) across the lid plus sin(angle)
 * straight up, and the lid foreshortens on the way exactly as it should.
 *
 * The two long lids meet on lucide's diagonal, which is the seam the box
 * breaks on; closed, their outlines fall on the rim, the silhouette and each
 * other, so they draw that seam themselves and the resting glyph is lucide's.
 * The two side lids are the ones a real box folds in first and hides beneath:
 * they have no closed shape to draw, so they open out of their own hinge.
 */

/** Half of each lid axis: the flat offset from a hinge to the lid's middle. */
const ALONG_SEAM = { x: 4.355, y: -2.5 };
const ACROSS_SEAM = { x: 4.355, y: 2.5 };
/** How far a lid stands up when vertical, in glyph units. */
const RISE = 5;

/**
 * Where the lids come to rest. Near flat is the only angle that serves all
 * four: each lid's projected area runs on its own phase, so at 105 degrees
 * they all pile upward and overlap, and at 135 the near one is edge-on. Laid
 * out at 160 they splay left, right, up-left and up-right, four directions
 * with four distinct shapes.
 */
const OPEN_ANGLE = 160;

type Point = { x: number; y: number };
type Lid = {
  hinge: [Point, Point];
  axis: Point;
  side: 1 | -1;
  /** Long lids show their closed shape; side lids start folded away. */
  closed: "flat" | "hidden";
};

const P = (x: number, y: number): Point => ({ x, y });

const LIDS: Lid[] = [
  // Long lids, hinged on the two edges the seam runs parallel to.
  { hinge: [P(12, 12), P(3.29, 7)], axis: ALONG_SEAM, side: 1, closed: "flat" },
  {
    hinge: [P(12, 2), P(20.71, 7)],
    axis: ALONG_SEAM,
    side: -1,
    closed: "flat",
  },
  // Side lids, hinged on the other two edges.
  {
    hinge: [P(3.29, 7), P(12, 2)],
    axis: ACROSS_SEAM,
    side: 1,
    closed: "hidden",
  },
  {
    hinge: [P(12, 12), P(20.71, 7)],
    axis: ACROSS_SEAM,
    side: -1,
    closed: "hidden",
  },
];

function lidPath({ hinge, axis, side }: Lid, degrees: number | null): string {
  const [a, b] = hinge;
  // A null angle is the folded-away state: the lid collapses onto its hinge,
  // which is a line the icon already draws, so it renders as nothing.
  const radians = degrees === null ? null : (degrees * Math.PI) / 180;
  const offset =
    radians === null
      ? { x: 0, y: 0 }
      : {
          x: Math.cos(radians) * axis.x * side,
          y: Math.cos(radians) * axis.y * side - Math.sin(radians) * RISE,
        };
  const corner = (p: Point) =>
    `${(p.x + offset.x).toFixed(2)} ${(p.y + offset.y).toFixed(2)}`;
  return `M${a.x} ${a.y}L${b.x} ${b.y}L${corner(b)}L${corner(a)}Z`;
}

const SWING = { duration: 0.42, ease: EASE_ENTRANCE };

const LID_VARIANTS: Variants[] = LIDS.map((lid) => {
  const shut = lidPath(lid, lid.closed === "flat" ? 0 : null);
  return {
    idle: { d: shut, transition: SETTLE },
    hover: { d: lidPath(lid, OPEN_ANGLE), transition: SWING },
  };
});

export function ProductsIcon({ className }: NavIconProps) {
  return (
    <IconSvg className={className}>
      <path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" />
      <path d="M12 22V12" />

      {/* The rim of the opening. */}
      <polyline points="3.29 7 12 12 20.71 7" />

      {LIDS.map((lid, i) => (
        <motion.path
          key={i}
          variants={LID_VARIANTS[i]}
          d={lidPath(lid, lid.closed === "flat" ? 0 : null)}
        />
      ))}
    </IconSvg>
  );
}
