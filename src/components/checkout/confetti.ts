import { contrastRatio, hexToHsv, hsvToHex, mixHex } from "@/lib/format/color";

/**
 * THE THANK-YOU PAGE'S CONFETTI, as a small particle system: what it looks
 * like (the palette), how it moves (the physics) and how one piece is drawn.
 * Pure and framework-free, so it is unit-tested on its own and the component
 * (Celebration.tsx) only owns the canvas and the animation frame.
 *
 * WHAT MAKES IT READ AS CONFETTI rather than as shapes sliding down: pieces are
 * LAUNCHED (a burst from the order's check mark, fanned upward), then gravity
 * and air drag take over, so they rise, slow, hang and fall; each one tumbles
 * (its face turns towards and away from the eye, drawn as a squash and a
 * shade, the way paper catches the light); and each flutters side to side on
 * the way down. A second, lighter shower drifts in across the whole width
 * after the pop, so the moment fills the screen instead of one column.
 *
 * DETERMINISTIC: every random draw comes from a seeded generator, so the burst
 * is the same on every play, and the editor's "Play it" shows exactly what a
 * buyer will see.
 *
 * Raw colour values are allowed in THIS file alone, like the storefront's
 * background presets: they are the confetti's tokens.
 */

/** The attribute the burst's origin carries (the order's check mark). Here,
 *  in a plain module, because the order page that sets it renders on the
 *  server, where a "use client" module's constants arrive as references. */
export const CELEBRATION_ORIGIN = "data-celebration-origin";

/** Frames are measured at 60 per second; `step` scales by real elapsed time. */
const FRAME_MS = 1000 / 60;

/** Down, per frame per frame. */
const GRAVITY = 0.2;
/** Paper does not fall fast: past this it is at terminal velocity. */
const TERMINAL_FALL = 3.4;

/** A small pop around the check mark, the moment it lands. */
const POP_PIECES = 36;
/** Each of the two cannons at the foot of the screen: one piece per this
 *  many px of width, within bounds, so a monitor is as full as a phone. */
const CANNON_PX_PER_PIECE = 9;
const CANNON_PIECES_MIN = 55;
const CANNON_PIECES_MAX = 120;
/** A few stragglers drifting in from above once the rest are falling. */
const SHOWER_PIECES = 30;
/** How high the cannons aim: their pieces peak around this share of the way
 *  up the first screenful, over the heading, then fall back through it. */
const CANNON_REACH = 0.86;
/** The first screenful, in px: on a tall contained page (the editor's
 *  artboard) the cannons fire from the foot of what a buyer first sees, not
 *  from the bottom of the whole page. */
const STAGE_MAX = 900;
/** How long a piece may live, in frames, before it fades out wherever it is. */
const LIFE_MIN = 160;
const LIFE_MAX = 215;
/** The last share of a piece's life, over which it fades. */
const FADE_SHARE = 0.28;

/** The metallic set for a shop whose brand is black, white and greys: gold,
 *  champagne and silver read as celebration without inventing a hue. */
const METALLICS = ["#d9a93f", "#f0dcae", "#b9bec7", "#8b929c"] as const;
/** The warm highlight every palette carries. */
const GOLD = "#e8b44c";

export type ConfettiShape = "rect" | "square" | "circle" | "strip";

export type ConfettiPiece = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  shape: ConfettiShape;
  color: string;
  /** Turn in the plane, and how fast. */
  rotation: number;
  spin: number;
  /** The tumble: the face's angle to the eye, and how fast it turns. */
  tumble: number;
  tumbleSpeed: number;
  /** Side-to-side flutter while falling. */
  wobble: number;
  wobbleSpeed: number;
  wobbleSize: number;
  /** Per-frame velocity kept after air drag. */
  drag: number;
  /** Frames before it starts. */
  delay: number;
  age: number;
  life: number;
};

/** mulberry32: small, fast, and the same numbers every time for one seed. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Whether a colour has a hue worth building on (not black, white or grey). */
function isChromatic(hex: string): boolean {
  const hsv = hexToHsv(hex);
  return hsv !== null && hsv.s >= 18 && hsv.v >= 15;
}

/**
 * THE COLOURS, built from the shop's own. A brand with a hue gets that hue,
 * a lighter tint of it, its two neighbours on the wheel and a warm gold, so
 * it is festive and still unmistakably the shop's. A black-and-white brand
 * gets its own dark plus metallics. Anything that would vanish against the
 * page it falls over is left out, and there are always at least three.
 */
export function confettiPalette({
  accent,
  button,
  surface,
}: {
  /** The storefront accent. */
  accent: string;
  /** The pay button's fill (the product page's buy button). */
  button: string;
  /** The page the pieces fall over. */
  surface: string;
}): string[] {
  const brand = [...new Set([button, accent].map((hex) => hex.toLowerCase()))];
  const hued = brand.find(isChromatic);
  let colors: string[];
  if (hued) {
    const { h, s, v } = hexToHsv(hued)!;
    colors = [
      ...brand,
      mixHex(hued, "#ffffff", 0.45),
      hsvToHex({ h: h + 38, s: Math.max(55, s * 0.9), v: Math.max(80, v) }),
      hsvToHex({ h: h - 38, s: Math.max(50, s * 0.8), v: Math.max(85, v) }),
      GOLD,
    ];
  } else {
    colors = [...brand, ...METALLICS];
  }
  const visible = [...new Set(colors)].filter((hex) => contrastRatio(hex, surface) >= 1.3);
  // Never fewer than three: metallics top up a palette the page ate.
  for (const hex of METALLICS) {
    if (visible.length >= 3) break;
    if (!visible.includes(hex) && contrastRatio(hex, surface) >= 1.3) visible.push(hex);
  }
  return visible.length > 0 ? visible : [GOLD];
}

const between = (random: () => number, min: number, max: number) => min + (max - min) * random();

/** How high a piece launched straight up at `speed` climbs, stepped by the
 *  very rule stepConfetti moves it by (so the two cannot disagree). */
function peakHeight(speed: number, drag: number): number {
  let vy = -speed;
  let climbed = 0;
  while (vy < 0) {
    climbed -= vy;
    vy = vy * drag + GRAVITY;
  }
  return climbed;
}

const CLIMB_CACHE = new Map<string, number>();

/**
 * The upward launch speed that makes a piece with this air drag peak `rise`
 * px above where it started. Drag takes too much for the frictionless
 * formula to be near, so it is found by bisection over peakHeight, and
 * remembered per (rise, drag), rounded to the pixel.
 */
export function climbSpeed(rise: number, drag: number): number {
  const key = `${Math.round(rise)}:${drag}`;
  const known = CLIMB_CACHE.get(key);
  if (known !== undefined) return known;
  let low = 0;
  let high = 200;
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    if (peakHeight(mid, drag) < rise) low = mid;
    else high = mid;
  }
  CLIMB_CACHE.set(key, high);
  return high;
}

function shapeFor(random: () => number): { shape: ConfettiShape; width: number; height: number } {
  const roll = random();
  if (roll < 0.5) return { shape: "rect", width: between(random, 7, 11), height: between(random, 4, 6) };
  if (roll < 0.7) return { shape: "square", width: between(random, 6, 8), height: 0 };
  if (roll < 0.85) return { shape: "circle", width: between(random, 5, 7), height: 0 };
  return { shape: "strip", width: between(random, 2.5, 3.5), height: between(random, 12, 18) };
}

/**
 * Every piece of one celebration, placed and launched, in three parts:
 *
 *   POP      a small ring bursting out of the check mark (`origin`), mostly
 *            sideways, the instant it lands;
 *   CANNONS  two volleys from the bottom corners of the first screenful,
 *            aimed up and in, so they arc over the heading and flutter down
 *            across the whole page. From below, because the check mark sits
 *            near the top of the screen: a burst fired UP from there leaves
 *            the screen at once and nobody sees it;
 *   SHOWER   a few stragglers drifting in from above as the rest come down.
 *
 * Positions are the canvas's own pixels. Launch speeds come from the height
 * they must reach, so a phone's volley peaks on the phone and a desktop's on
 * the desktop.
 */
export function createConfetti({
  width,
  height,
  origin,
  colors,
  seed = 0x5eed,
}: {
  width: number;
  height: number;
  origin: { x: number; y: number };
  colors: readonly string[];
  seed?: number;
}): ConfettiPiece[] {
  const random = seededRandom(seed);
  const stage = Math.min(height, STAGE_MAX);
  const pieces: ConfettiPiece[] = [];

  const base = (x: number, y: number, vx: number, vy: number, delay: number): ConfettiPiece => {
    const { shape, width: w, height: h } = shapeFor(random);
    return {
      x,
      y,
      vx,
      vy,
      width: w,
      height: h,
      shape,
      color: colors[Math.floor(random() * colors.length)],
      rotation: random() * Math.PI * 2,
      spin: between(random, -0.12, 0.12),
      tumble: random() * Math.PI * 2,
      tumbleSpeed: between(random, 0.08, 0.2),
      wobble: random() * Math.PI * 2,
      wobbleSpeed: between(random, 0.04, 0.09),
      wobbleSize: between(random, 0.4, 1.2),
      // Strips are long and light, and catch more air.
      drag: shape === "strip" ? 0.965 : shape === "circle" ? 0.982 : 0.975,
      delay,
      age: 0,
      life: between(random, LIFE_MIN, LIFE_MAX),
    };
  };

  for (let i = 0; i < POP_PIECES; i++) {
    // All round, but flattened: out to the sides more than up or down, each
    // piece travelling a share of the screen's width (see the cannons for
    // how drag turns a distance into a speed) so a phone's pop stays on it.
    const angle = between(random, 0, Math.PI * 2);
    const piece = base(origin.x + Math.cos(angle) * 14, origin.y + Math.sin(angle) * 14, 0, 0, between(random, 0, 3));
    piece.vx = Math.cos(angle) * width * between(random, 0.1, 0.32) * (1 - piece.drag);
    piece.vy = Math.sin(angle) * between(random, 2, 4.5) - 1.5;
    pieces.push(piece);
  }

  const rise = stage * CANNON_REACH;
  const perCannon = Math.round(
    Math.min(Math.max(width / CANNON_PX_PER_PIECE, CANNON_PIECES_MIN), CANNON_PIECES_MAX),
  );
  for (const side of [-1, 1]) {
    const x = side < 0 ? width * 0.04 : width * 0.96;
    for (let i = 0; i < perCannon; i++) {
      const piece = base(x + between(random, -8, 8), stage + between(random, 0, 10), 0, 0, between(random, 2, 12));
      // Up and in towards the middle, fanned so the volley spreads: each
      // piece peaks between about two thirds and the full reach, and drifts inward a
      // share of the screen's width (drag stops a piece after v / (1 - drag)
      // px, which is what turns a distance into a speed), so a phone's volley
      // stays on the phone and a desktop's reaches the middle.
      piece.vy = -climbSpeed(rise * between(random, 0.62, 1), piece.drag);
      piece.vx = -side * width * between(random, 0.08, 0.55) * (1 - piece.drag);
      pieces.push(piece);
    }
  }

  for (let i = 0; i < SHOWER_PIECES; i++) {
    pieces.push(
      base(
        between(random, 0, width),
        between(random, -140, -12),
        between(random, -0.6, 0.6),
        between(random, 0.6, 1.8),
        between(random, 30, 70),
      ),
    );
  }
  return pieces;
}

/**
 * Move every piece on by `dt` frames. Returns whether any is still to be seen:
 * a piece is finished once it has lived its life or fallen past the bottom.
 */
export function stepConfetti(pieces: ConfettiPiece[], dt: number, height: number): boolean {
  let alive = false;
  for (const piece of pieces) {
    if (piece.delay > 0) {
      piece.delay -= dt;
      alive = true;
      continue;
    }
    if (piece.age >= piece.life || piece.y > height + 40) continue;
    alive = true;
    const keep = Math.pow(piece.drag, dt);
    piece.vx *= keep;
    piece.vy = Math.min(piece.vy * keep + GRAVITY * dt, TERMINAL_FALL + piece.width * 0.08);
    piece.wobble += piece.wobbleSpeed * dt;
    // The flutter grows as the piece slows: a launched piece flies straight,
    // a falling one drifts.
    const drift = Math.sin(piece.wobble) * piece.wobbleSize * Math.min(1, piece.age / 40);
    piece.x += (piece.vx + drift) * dt;
    piece.y += piece.vy * dt;
    piece.rotation += piece.spin * dt;
    piece.tumble += piece.tumbleSpeed * dt;
    piece.age += dt;
  }
  return alive;
}

/** How opaque a piece is now: whole, then fading over the end of its life. */
export function pieceOpacity(piece: ConfettiPiece): number {
  const fadeFrom = piece.life * (1 - FADE_SHARE);
  if (piece.age <= fadeFrom) return 1;
  return Math.max(0, 1 - (piece.age - fadeFrom) / (piece.life - fadeFrom));
}

/** Draw every piece that has started and is still alive. */
export function drawConfetti(context: CanvasRenderingContext2D, pieces: readonly ConfettiPiece[]): void {
  for (const piece of pieces) {
    if (piece.delay > 0) continue;
    const opacity = pieceOpacity(piece);
    if (opacity <= 0) continue;
    // The tumble: the face squashes as it turns edge-on, and darkens, as
    // paper does when it turns away from the light.
    const face = Math.cos(piece.tumble);
    context.save();
    context.globalAlpha = opacity;
    context.translate(piece.x, piece.y);
    context.rotate(piece.rotation);
    context.scale(1, Math.max(Math.abs(face), 0.08));
    context.fillStyle = piece.color;
    context.beginPath();
    if (piece.shape === "circle") {
      context.arc(0, 0, piece.width / 2, 0, Math.PI * 2);
    } else if (piece.shape === "square") {
      context.rect(-piece.width / 2, -piece.width / 2, piece.width, piece.width);
    } else {
      context.rect(-piece.width / 2, -piece.height / 2, piece.width, piece.height);
    }
    context.fill();
    const shade = (1 - Math.abs(face)) * 0.35;
    if (shade > 0.02) {
      context.fillStyle = face < 0 ? `rgba(0,0,0,${shade})` : `rgba(255,255,255,${shade * 0.6})`;
      context.fill();
    }
    context.restore();
  }
}

/** Frames elapsed between two timestamps, bounded so a stalled tab resumes
 *  smoothly instead of teleporting every piece. */
export function framesBetween(from: number, to: number): number {
  return Math.min(Math.max((to - from) / FRAME_MS, 0.25), 3);
}
