/**
 * The shape of the success colour that streams out from behind the van in the
 * mark-shipped button (ShipConfirmButton). Pure geometry, kept apart from the
 * component so it can be reasoned about and tested without a browser.
 *
 * Two shapes come out of it:
 *
 *  - `coneClip`: a plain cone as a CSS polygon, tip at the van and fanning back
 *    to the top and bottom of the button. It reveals the WORDS, which must not
 *    be warped.
 *  - `cloudPath`: the same cone as an SVG path, built up from overlapping
 *    discs: a spine of beads down the middle (the thread it starts as), a row
 *    of bumps along each side, and a few blobs that leave the edge and float
 *    off. The component runs it through a blur-and-threshold ("gooey") filter,
 *    so the discs melt into one smooth body with an edge that is even but never
 *    regular, and the floaters part from it and pop like bubbles.
 *
 * Everything is a function of how far the van has travelled (`x`), so playing
 * it forwards, stopping it or restarting it needs no state.
 */

/** Where things are, measured when the truck sets off. */
export type Geometry = {
  /** Button height. */
  height: number;
  /** Where the van's middle sits at rest: the cone's tip starts here. */
  rest: number;
  /** How far the van travels, far enough that the cone has cleared the button too. */
  total: number;
  /** The cone's length at full width. */
  cone: number;
};

export const NO_GEOMETRY: Geometry = { height: 0, rest: 0, total: 0, cone: 0 };

/** The wash, shut (all clipped from the right) and open. */
export const CLIP_SHUT = "inset(0 100% 0 0)";
export const CLIP_OPEN = "inset(0 0 0 0)";

/**
 * The cone's length, as a multiple of the button's height: how far behind the
 * van its edges take to reach the top and bottom. Longer is a narrower cone.
 */
export const CONE_LENGTH = 1.2;
/** The share of the van's journey over which the cone opens from a thread to full width. */
export const CONE_OPENS_OVER = 0.35;

/**
 * The smallest disc that survives the gooey filter: blur then threshold erases
 * anything much smaller than its own blur radius, so a smaller one would just
 * vanish instead of joining or leaving the body.
 */
const MIN_BLOB = 3.2;
/** Spacing of the beads down the cone's spine, and the most there can be. */
const SPINE_STEP = 7;
const SPINE_MAX = 26;
/**
 * The discs stream out of the van rather than appearing all along its path: the
 * length they cover starts at TRAIL_START px and grows TRAIL_GAIN px for every
 * px the van travels, until it has reached where the cone meets the top.
 */
const TRAIL_START = 8;
const TRAIL_GAIN = 2.4;
const BUMPS_PER_SIDE = 9;
const FLOATERS = 10;

type Point = readonly [number, number];

/** The cone at one moment, in the coordinates of the layer it is drawn on. */
type Cone = {
  /** Where the tip is (under the van). */
  tip: number;
  /** The middle line. */
  cy: number;
  /** Half the layer's height. */
  half: number;
  /** The layer's height. */
  full: number;
  /** How far the sides have spread: the height gained per px behind the tip. */
  slope: number;
  /** 0 (a thread) to 1 (fully open). */
  opened: number;
  /** How far behind the tip the sides reach the top and bottom. */
  reach: number;
  /** Where that is. */
  back: number;
};

/**
 * The cone for a van that has travelled `x`, on a layer that overhangs the
 * button by `margin` on every side (its coordinates start that far out). `lag`
 * holds the tip back by that many px. Null while there is no cone yet.
 */
function shape(x: number, g: Geometry, margin: number, lag: number): Cone | null {
  const travelled = x - lag;
  if (g.height === 0 || travelled <= 0) return null;
  const buttonHalf = g.height / 2;
  const half = buttonHalf + margin;
  const tip = g.rest + margin + travelled;
  const opened = Math.min(1, x / (g.total * CONE_OPENS_OVER));
  const slope = (buttonHalf / g.cone) * opened;
  const reach = half / slope;
  return { tip, cy: half, half, full: g.height + 2 * margin, slope, opened, reach, back: tip - reach };
}

/** The cone's outline, clockwise. */
function outline(c: Cone): Point[] {
  if (c.back <= 0) {
    // Still narrower than the layer where it meets the left edge.
    const y = c.half - c.slope * c.tip;
    return [[0, y], [c.tip, c.half], [0, c.full - y]];
  }
  return [[0, 0], [c.back, 0], [c.tip, c.half], [c.back, c.full], [0, c.full]];
}

/** The van's progress through its journey, 0 to 1. */
export const journey = (x: number, g: Geometry) =>
  g.total === 0 ? 0 : Math.min(1, Math.max(0, x / g.total));

/**
 * The plain cone as a CSS polygon: tip at the van, sides fanning back, and
 * everything behind that covered. It starts as a thread and opens as the van
 * picks up speed, so the colour is drawn out of the van rather than revealed by
 * an edge.
 */
export function coneClip(x: number, g: Geometry, margin = 0, lag = 0): string {
  const c = shape(x, g, margin, lag);
  if (!c) return CLIP_SHUT;
  return `polygon(${outline(c).map(([px, py]) => `${px}px ${py}px`).join(", ")})`;
}

// --- The cloud ---------------------------------------------------------------

/** Small deterministic random numbers, so the cloud is the same every time it plays. */
function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = seeded(20260930);

/**
 * How loose the cloud is: 0 would be perfectly regular, 1 was as random as it
 * first shipped. It should read as even, with just enough give that it is not a
 * pattern, so every table below is a steady base value nudged by this much.
 */
const LOOSENESS = 0.4;
/** A nudge between -LOOSENESS and LOOSENESS, the same every time the cloud plays. */
const wobble = () => (rand() * 2 - 1) * LOOSENESS;

/**
 * A bump on the cone's side. Evenly spaced and near enough the same size, and
 * their lapping follows on from one to the next (a ripple running down the
 * edge) rather than each keeping its own time.
 */
const makeBumps = (sideOffset: number) =>
  Array.from({ length: BUMPS_PER_SIDE }, (_, i) => ({
    /** How far along the side, 0 (tip) to 1 (where it meets the top). */
    along: (i + 0.5 + wobble() * 0.9) / BUMPS_PER_SIDE,
    size: 5.9 * (1 + wobble() * 0.29),
    phase: i * 0.9 + sideOffset + wobble() * Math.PI * 0.5,
    /** Radians of lapping per px of van travel. */
    rate: 0.08 * (1 + wobble() * 0.4),
  }));

const BUMPS = { above: makeBumps(0), below: makeBumps(1.4) };

/**
 * A blob that leaves the edge, floats away and pops: alternating sides, born at
 * even intervals, all much alike. Lengths are px of the van's travel.
 */
const FLOATERS_LIST = Array.from({ length: FLOATERS }, (_, i) => ({
  /** Which side it leaves from. */
  side: i % 2 === 0 ? -1 : 1,
  /** When it is born, as a share of the journey: early, while there is black to float in. */
  born: 0.04 + (i / FLOATERS) * 0.4 + wobble() * 0.04,
  /** How far behind the tip it leaves the edge. */
  behind: 24 + wobble() * 20,
  size: 5.6 * (1 + wobble() * 0.25),
  /** How long it lasts, as a share of the journey. */
  life: 0.22 * (1 + wobble() * 0.3),
  /** How far outside the edge it starts, so it is never born inside the cone. */
  clear: 3.5 + wobble() * 1.5,
  /** Px it drifts outward per px of travel: quicker than the cone widens, or it would be swallowed. */
  out: 0.8 * (1 + wobble() * 0.3),
  /** Px it is left behind per px of travel. */
  back: 0.12 * (1 + wobble() * 0.5),
  sway: 2.5 * (1 + wobble() * 0.5),
  phase: i * 1.3 + wobble() * Math.PI * 0.5,
}));

const num = (v: number) => v.toFixed(1);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A filled disc, clockwise like the outline so overlaps add up instead of cancelling. */
function disc(cx: number, cy: number, r: number): string {
  return `M${num(cx - r)} ${num(cy)}a${num(r)} ${num(r)} 0 1 1 ${num(2 * r)} 0a${num(r)} ${num(r)} 0 1 1 ${num(-2 * r)} 0Z`;
}

/**
 * The cone as an SVG path of overlapping discs, for the gooey filter to melt
 * into one body. Empty until the van has set off.
 */
export function cloudPath(x: number, g: Geometry, margin: number): string {
  const c = shape(x, g, margin, 0);
  if (!c) return "";
  // How far behind the tip the discs reach so far: how much of the sides can be
  // seen before the flat part takes over, held back while the van has only just gone.
  const whole = Math.min(c.reach, c.tip);
  const span = Math.min(whole, TRAIL_START + x * TRAIL_GAIN);

  // The plain cone underneath fills the body between the discs. It joins in only
  // once the discs have caught up with it: earlier, its thin far end would show
  // as a needle shooting out to the left edge ahead of the cloud.
  const parts: string[] = [];
  if (span >= whole) parts.push(`M${outline(c).map(([px, py]) => `${num(px)} ${num(py)}`).join("L")}Z`);

  // The spine: a string of beads down the middle. It is what shows while the
  // cone is still a thread, and the discs' size follows the cone's width.
  const step = Math.max(SPINE_STEP, span / SPINE_MAX);
  for (let d = 0; d <= span; d += step) {
    parts.push(disc(c.tip - d, c.cy, clamp(c.slope * d * 0.9, MIN_BLOB, c.half)));
  }

  // The sides: bumps sitting on each edge, lapping in and out as the van goes.
  for (const [side, bumps] of [[-1, BUMPS.above], [1, BUMPS.below]] as const) {
    for (const b of bumps) {
      const d = b.along * span;
      const edge = Math.min(c.half, c.slope * d);
      const lap = b.size * 0.25 * Math.sin(b.phase + x * b.rate);
      const r = Math.max(MIN_BLOB, b.size * (0.5 + 0.5 * c.opened));
      parts.push(disc(c.tip - d, c.cy + side * (edge + lap), r));
    }
  }

  // The floaters: leave the edge, drift out and back, shrink and pop.
  const buttonHalf = g.height / 2;
  for (const f of FLOATERS_LIST) {
    const born = f.born * g.total;
    const age = x - born;
    const life = f.life * g.total;
    if (age <= 0 || age >= life) continue;
    const slopeThen = (buttonHalf / g.cone) * Math.min(1, born / (g.total * CONE_OPENS_OVER));
    const edge = Math.min(c.half, slopeThen * f.behind);
    const startX = g.rest + margin + born - f.behind;
    const startY = c.cy + f.side * (edge + f.clear);
    const r = MIN_BLOB + (f.size - MIN_BLOB) * Math.sin((Math.PI * age) / life);
    parts.push(
      disc(
        startX - f.back * age + f.sway * Math.sin(f.phase + age * 0.09),
        startY + f.side * f.out * age,
        r,
      ),
    );
  }

  return parts.join("");
}
