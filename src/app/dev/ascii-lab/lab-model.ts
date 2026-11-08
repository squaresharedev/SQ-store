import {
  ASCII_CODE_GLYPHS,
  ASCII_DEFAULTS,
  ASCII_PALETTES,
  ASCII_SHAPES,
  type AsciiClickEffect,
  type AsciiFieldSettings,
  type AsciiShape,
  type AsciiSurface,
} from "@/components/ui/gradient-ascii-tokens";
import {
  between,
  changedProps as changedFrom,
  decodeLabHash,
  encodeLabHash,
  pick,
  toJsx as jsxOf,
  type LabFit,
} from "../lab-kit/state";

/**
 * The ASCII lab's model: what it can tune, where it can show a field, and the
 * palettes and glyph sets it offers. Colours here may be raw hex: the lab is
 * for trying things, and a palette that wins gets promoted to a token in
 * ui/gradient-ascii-tokens before anything ships with it.
 */

/** The spots on Settings > Connected apps a field could fill. */
export const LAB_PLACEMENTS = [
  { id: "box", label: "Plain box" },
  { id: "corner", label: "Corner art, faint" },
  { id: "corner-bold", label: "Corner art, full strength" },
  { id: "band", label: "Band across the card" },
  { id: "backdrop", label: "Card backdrop" },
  { id: "hero", label: "Page hero" },
  { id: "slab", label: "Address slab" },
  { id: "empty", label: "Empty list" },
] as const;
export type LabPlacement = (typeof LAB_PLACEMENTS)[number]["id"];

/** Every visual prop of the field, all set. */
export type LabProps = AsciiFieldSettings;

/** The field's own defaults, so the lab can tell what a variation changed. */
const LAB_DEFAULTS = ASCII_DEFAULTS;

/** A variation the lab can load: a field and where it sits. */
export type LabPreset = {
  id: string;
  name: string;
  /** Which tab it is listed under. */
  group: string;
  note: string;
  fit: LabFit;
  placement: LabPlacement;
  props: Partial<LabProps>;
};

/** Ramps to start from, darkest to lightest. */
export const LAB_PALETTES: readonly { id: string; label: string; colors: readonly string[] }[] = [
  { id: "ink", label: "Ink", colors: ASCII_PALETTES.ink },
  { id: "code", label: "Code greens", colors: ASCII_PALETTES.code },
  { id: "graphite", label: "Graphite", colors: ["#000000", "#3f3f46", "#a1a1aa", "#ffffff"] },
  { id: "ice", label: "Ice", colors: ["#0b1a4d", "#1e3fd8", "#38bdf8", "#a5d8ff", "#f6f8ff"] },
  { id: "purple", label: "Brand purple", colors: ["#3b0764", "#7e22ce", "#a855f7", "#e9d5ff", "#faf5ff"] },
  { id: "aurora", label: "Aurora", colors: ["#022c22", "#059669", "#22d3ee", "#a78bfa", "#f5f3ff"] },
  { id: "sunset", label: "Sunset", colors: ["#3b0a1a", "#be123c", "#fb7185", "#fdba74", "#fff7ed"] },
  { id: "ember", label: "Ember", colors: ["#1c0a00", "#9a3412", "#f97316", "#fde047", "#fffbeb"] },
  { id: "teal", label: "Teal", colors: ["#042f2e", "#0f766e", "#2dd4bf", "#ccfbf1"] },
  { id: "candy", label: "Candy", colors: ["#9d174d", "#f472b6", "#c4b5fd", "#bae6fd", "#ffffff"] },
];

/** Glyph sets, faintest to fullest, each starting with a space. */
export const LAB_GLYPHS: readonly { id: string; label: string; characters: string }[] = [
  { id: "code", label: "Code", characters: ASCII_CODE_GLYPHS },
  { id: "classic", label: "Classic", characters: " =+xX0S8#@" },
  { id: "blocks", label: "Blocks", characters: " ░▒▓█" },
  { id: "dots", label: "Dots", characters: " .·•●" },
  { id: "braille", label: "Braille", characters: " ⠁⠃⠇⡇⣇⣧⣷⣿" },
  { id: "box", label: "Box drawing", characters: " ─┄┼╋" },
  { id: "binary", label: "Binary", characters: " 01" },
  { id: "hex", label: "Hex", characters: " 0123456789abcdef" },
  { id: "squares", label: "Squares", characters: " ▫□▪■" },
  { id: "slashes", label: "Slashes", characters: " .:/\\|X" },
];

type NumberKey = {
  [K in keyof LabProps]: LabProps[K] extends number ? K : never;
}[keyof LabProps];

/** The sliders, in the order the panel lists them. */
export const LAB_SLIDERS: readonly { key: NumberKey; label: string; min: number; max: number; step: number }[] = [
  { key: "cellSize", label: "Cell size (px)", min: 6, max: 40, step: 1 },
  { key: "density", label: "Density", min: 0, max: 1, step: 0.01 },
  { key: "glyphOpacity", label: "Glyph strength", min: 0, max: 1, step: 0.01 },
  { key: "gradientOpacity", label: "Wash", min: 0, max: 1, step: 0.01 },
  { key: "glow", label: "Glow", min: 0, max: 2, step: 0.01 },
  { key: "scale", label: "Scale", min: 0.4, max: 2.5, step: 0.01 },
  { key: "softness", label: "Softness", min: 0, max: 1, step: 0.01 },
  { key: "flow", label: "Flow", min: 0, max: 2, step: 0.01 },
  { key: "speed", label: "Speed", min: 0, max: 3, step: 0.01 },
  { key: "flicker", label: "Flicker", min: 0, max: 1, step: 0.01 },
  { key: "grain", label: "Grain", min: 0, max: 0.4, step: 0.01 },
  { key: "depthOfField", label: "Depth of field", min: 0, max: 1, step: 0.01 },
  { key: "variation", label: "Variation", min: 0, max: 40, step: 1 },
  { key: "scrambleRadius", label: "Scramble radius", min: 0.02, max: 0.4, step: 0.01 },
];

export const LAB_SURFACES: readonly AsciiSurface[] = ["light", "dark"];
export const LAB_CLICK_EFFECTS: readonly AsciiClickEffect[] = ["wave", "burst", "none"];

/** A preset's props over the defaults: everything the field will be given. */
export const withDefaults = (props: Partial<LabProps>): LabProps => ({ ...LAB_DEFAULTS, ...props });

/** What a set of props changes from the defaults, for the copy and the link. */
export const changedProps = (props: LabProps): Partial<LabProps> => changedFrom(LAB_DEFAULTS, props);

/** The field as JSX to paste: only the props that differ from its defaults. */
export const toJsx = (props: LabProps): string => jsxOf("GradientAscii", changedProps(props));

/** The lab's state as it lives in the address bar, so a variation can be sent as a link. */
export type LabState = { placement: LabPlacement; props: LabProps; presetId: string | null };

export function encodeState(state: LabState): string {
  return encodeLabHash({ placement: state.placement, props: changedProps(state.props), presetId: state.presetId });
}

const isPlacement = (value: unknown): value is LabPlacement =>
  LAB_PLACEMENTS.some((placement) => placement.id === value);
const isShape = (value: unknown): value is AsciiShape => (ASCII_SHAPES as readonly unknown[]).includes(value);

/** Back from a link; anything unreadable falls back to the defaults. */
export function decodeState(hash: string): LabState | null {
  const raw = decodeLabHash(hash);
  if (!raw) return null;
  const props = withDefaults((raw.props ?? {}) as Partial<LabProps>);
  if (!isShape(props.shape)) props.shape = LAB_DEFAULTS.shape;
  return {
    placement: isPlacement(raw.placement) ? raw.placement : "box",
    props,
    presetId: typeof raw.presetId === "string" ? raw.presetId : null,
  };
}

/** A colour from hue, saturation and lightness (0 to 360, 0 to 1, 0 to 1), as hex. */
function hsl(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return `#${[0, 8, 4].map((n) => Math.round(channel(n) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** A ramp round one hue, drifting a little as it lightens. */
function hueRamp(random: () => number): string[] {
  const hue = random() * 360;
  const drift = between(-60, 60, random);
  const steps = 3 + Math.floor(random() * 3);
  return Array.from({ length: steps }, (_, i) => {
    const t = i / (steps - 1);
    return hsl((hue + drift * t + 360) % 360, 0.55 + 0.35 * (1 - Math.abs(t - 0.5) * 2), 0.12 + 0.84 * t);
  });
}

/** Somewhere new, for when nothing in the presets is quite it. Keeps the placement. */
export function shuffle(random: () => number = Math.random): LabProps {
  return withDefaults({
    surface: random() < 0.5 ? "light" : "dark",
    shape: pick(ASCII_SHAPES, random),
    colors: random() < 0.55 ? pick(LAB_PALETTES, random).colors : hueRamp(random),
    characters: pick(LAB_GLYPHS, random).characters,
    cellSize: Math.round(between(10, 24, random)),
    density: between(0.5, 1, random),
    glyphOpacity: between(0.7, 1, random),
    gradientOpacity: between(0.2, 0.9, random),
    glow: between(0, 0.8, random),
    flicker: between(0, 0.5, random),
    softness: between(0.3, 1, random),
    scale: between(0.7, 1.6, random),
    flow: between(0.2, 1.2, random),
    speed: between(0.4, 1.6, random),
    variation: Math.round(between(0, 30, random)),
  });
}
