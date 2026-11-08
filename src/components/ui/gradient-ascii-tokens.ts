import type { GradientAsciiProps } from "@/components/ui/GradientAscii";

/**
 * What a GradientAscii field (ui/GradientAscii) is drawn in, kept out of its
 * client module so a server component can name a palette or a position too.
 */

/** Every shape the field can draw, in the order pickers list them. */
export const ASCII_SHAPES = [
  "horizon",
  "pinch",
  "rise",
  "eclipse",
  "wave",
  "rings",
  "beam",
  "orbit",
  "cloud",
] as const;
export type AsciiShape = (typeof ASCII_SHAPES)[number];
export type AsciiClickEffect = "wave" | "burst" | "none";
export type AsciiSurface = "light" | "dark";

/** The ramps a field is drawn in, darkest to lightest. Theme variables, read
 *  off the element, so a palette retunes with the tokens it names. */
export const ASCII_PALETTES = {
  /** The dashboard's greys: the corner-art family's ink (ui/CornerArt). */
  ink: ["var(--foreground)", "var(--muted-foreground)", "var(--border)"],
  /** The code block's greens (.code-surface), for the places a seller copies
   *  code or connects something. */
  code: ["var(--flow-green-deep)", "var(--color-success-dark)", "var(--flow-green-pale)"],
  /** Greys glowing white on black with a purple fringe: the MCP address slab. */
  terminal: [
    "var(--ascii-terminal-edge)",
    "var(--ascii-terminal-mid)",
    "var(--ascii-terminal-light)",
    "var(--ascii-terminal-core)",
  ],
} as const satisfies Record<string, readonly string[]>;

/** Glyphs from faintest to fullest: code punctuation, ending on the square. */
export const ASCII_CODE_GLYPHS = " .:-=+<>/{}#■";

/** A longer run of code punctuation with no square at the end, so a bright
 *  core stays type rather than turning into blocks. */
export const ASCII_TERMINAL_GLYPHS = " .:;-~=+*<>/|()[]{}%#";

/** How far below the middle of its frame `rise` glows from, in box heights
 *  at scale 1 (the shader's rise shape reads it). */
export const ASCII_RISE_SOURCE = 0.7;

/** The `center` that turns `rise` upside down in effect: its glow sits on the
 *  box's TOP edge at `x` (0 to 1), so the field pours out of a card's top
 *  edge, or out of its corner at 1. Pass the same `scale` the field gets. */
export const riseFromTop = (x: number, scale: number) => [x, -ASCII_RISE_SOURCE * scale] as const;

/** Every visual prop of a field, all set. */
export type AsciiFieldSettings = Required<Omit<GradientAsciiProps, "className" | "style">>;

/** What a field draws when a prop is left out. The one copy: the component
 *  reads it, and the ASCII lab reads it to tell what a variation changed. */
export const ASCII_DEFAULTS: AsciiFieldSettings = {
  colors: ASCII_PALETTES.ink,
  surface: "light",
  shape: "horizon",
  center: [0.5, 0.5],
  characters: ASCII_CODE_GLYPHS,
  cellSize: 14,
  density: 0.8,
  glyphOpacity: 0.85,
  gradientOpacity: 0.9,
  glow: 0.2,
  depthOfField: 0,
  flicker: 0.2,
  softness: 0.5,
  scale: 1,
  flow: 0.5,
  speed: 1,
  grain: 0.08,
  variation: 0,
  pointerScramble: true,
  scrambleRadius: 0.1,
  clickEffect: "wave",
  intro: true,
};
