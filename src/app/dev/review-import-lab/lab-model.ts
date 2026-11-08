import {
  BEAM_CARRIES,
  BEAM_COLOURS,
  BEAM_GLOWS,
  BEAM_LANDINGS,
  BEAM_LAYOUTS,
  BEAM_LINES,
  BEAM_MARKS,
  BEAM_PACE,
  BEAM_SOURCE_COUNT,
  BEAM_SOURCES,
  BEAM_TRAVELLERS,
  REVIEW_IMPORT_BEAMS_LOOK,
  beamsLook,
  type BeamSource,
  type ReviewImportBeamsLook,
} from "@/components/products/review-import-beams-tokens";
import { between, changedProps, decodeLabHash, encodeLabHash, pick, type LabFit } from "../lab-kit/state";

/**
 * The review import lab's model: the looks the beams graphic can try (its
 * own option lists, so the lab tunes what ships), where it is shown, the
 * presets' shape, and the state that lives in the address bar.
 */

/** Where the graphic is previewed: the import page's column, or a phone. */
export const LAB_PLACEMENTS = [
  { value: "page", label: "Import page" },
  { value: "phone", label: "Phone" },
] as const;
export type LabPlacement = (typeof LAB_PLACEMENTS)[number]["value"];

/** A variation the lab can load. */
export type LabPreset = {
  id: string;
  name: string;
  /** Which tab it is listed under. */
  group: string;
  note: string;
  fit: LabFit;
  look: Partial<ReviewImportBeamsLook>;
};

/** Every option, labelled for the panel, in the order the panel lists them. */
export const LAB_OPTIONS = {
  layout: BEAM_LAYOUTS.map((value) => ({
    value,
    label: { split: "Platforms on the left", arc: "On a curve", sides: "Platforms on both sides", stack: "Platforms above" }[value],
  })),
  source: BEAM_SOURCES.map((value) => ({
    value,
    label: {
      judgeme: "Judge.me",
      loox: "Loox",
      yotpo: "Yotpo",
      shopify: "Shopify",
      google: "Google",
      etsy: "Etsy",
      facebook: "Facebook",
      trustpilot: "Trustpilot",
    }[value],
  })),
  traveller: BEAM_TRAVELLERS.map((value) => ({
    value,
    label: { pulse: "Light only", count: "Count", review: "A review", card: "Review card", stream: "Stream of faces" }[value],
  })),
  landing: BEAM_LANDINGS.map((value) => ({ value, label: { fade: "Fades into the page", dock: "Glides into its row" }[value] })),
  line: BEAM_LINES.map((value) => ({ value, label: { line: "Line", dots: "Flowing dots" }[value] })),
  marks: BEAM_MARKS.map((value) => ({ value, label: { plain: "Plain icons", lettered: "Lettered (logo-like)" }[value] })),
  carry: BEAM_CARRIES.map((value) => ({ value, label: { each: "One after another", together: "All at once" }[value] })),
  colour: BEAM_COLOURS.map((value) => ({ value, label: { brand: "Their own colours", mono: "Ink" }[value] })),
  glow: BEAM_GLOWS.map((value) => ({ value, label: { source: "Platform's colour", acid: "App purple" }[value] })),
} as const;

/** The knobs' ranges. */
export const LAB_KNOBS = {
  pace: { min: BEAM_PACE.min, max: BEAM_PACE.max, step: 0.05 },
} as const;

/** A preset's look over the default one, put right the way the graphic puts it right. */
export const withDefaults = (look: Partial<ReviewImportBeamsLook>): ReviewImportBeamsLook => beamsLook(look);

/** `sources` with `source` switched on or off, kept in the panel's order and within BEAM_SOURCE_COUNT. */
export function toggleSource(sources: readonly BeamSource[], source: BeamSource): BeamSource[] {
  const on = sources.includes(source);
  if (on && sources.length <= BEAM_SOURCE_COUNT.min) return [...sources];
  if (!on && sources.length >= BEAM_SOURCE_COUNT.max) return [...sources];
  return BEAM_SOURCES.filter((candidate) => (candidate === source ? !on : sources.includes(candidate)));
}

/** The graphic as JSX to paste: only what differs from the default look. */
export function toJsx(look: ReviewImportBeamsLook): string {
  // Numbers to three places, so a slider's float noise never reaches the paste.
  const tidy = (_: string, value: unknown) => (typeof value === "number" ? Math.round(value * 1000) / 1000 : value);
  const changed = Object.entries(changedProps(REVIEW_IMPORT_BEAMS_LOOK, look)).map(
    ([key, value]) => `${key}: ${JSON.stringify(value, tidy)}`,
  );
  return changed.length ? `<ReviewImportBeams look={{ ${changed.join(", ")} }} />` : "<ReviewImportBeams />";
}

/** The lab's state as it lives in the address bar, so a variation can be sent as a link. */
export type LabState = { look: ReviewImportBeamsLook; placement: LabPlacement; presetId: string | null };

export function encodeState(state: LabState): string {
  return encodeLabHash({
    look: changedProps(REVIEW_IMPORT_BEAMS_LOOK, state.look),
    placement: state.placement,
    presetId: state.presetId,
  });
}

const oneOf = <T extends string>(list: readonly T[], value: unknown, fallback: T): T =>
  (list as readonly unknown[]).includes(value) ? (value as T) : fallback;

const numberOr = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/** Back from a link; anything unreadable falls back to the default look. */
export function decodeState(hash: string): LabState | null {
  const raw = decodeLabHash(hash);
  if (!raw) return null;
  const look = (raw.look && typeof raw.look === "object" ? raw.look : {}) as Partial<Record<keyof ReviewImportBeamsLook, unknown>>;
  const base = REVIEW_IMPORT_BEAMS_LOOK;
  return {
    look: beamsLook({
      layout: oneOf(BEAM_LAYOUTS, look.layout, base.layout),
      sources: Array.isArray(look.sources) ? (look.sources as BeamSource[]) : base.sources,
      marks: oneOf(BEAM_MARKS, look.marks, base.marks),
      labels: typeof look.labels === "boolean" ? look.labels : base.labels,
      traveller: oneOf(BEAM_TRAVELLERS, look.traveller, base.traveller),
      landing: oneOf(BEAM_LANDINGS, look.landing, base.landing),
      line: oneOf(BEAM_LINES, look.line, base.line),
      carry: oneOf(BEAM_CARRIES, look.carry, base.carry),
      colour: oneOf(BEAM_COLOURS, look.colour, base.colour),
      glow: oneOf(BEAM_GLOWS, look.glow, base.glow),
      pace: numberOr(look.pace, base.pace),
    }),
    placement: oneOf(
      LAB_PLACEMENTS.map((placement) => placement.value),
      raw.placement,
      "page",
    ),
    presetId: typeof raw.presetId === "string" ? raw.presetId : null,
  };
}

/** Somewhere new: three or four platforms, mostly named, mostly with reviews riding. */
export function shuffle(random: () => number = Math.random): ReviewImportBeamsLook {
  const count = pick([3, 4, 4], random);
  const order = BEAM_SOURCES.map((source) => ({ source, key: random() })).sort((a, b) => a.key - b.key);
  const chosen = order.slice(0, count).map(({ source }) => source);
  return beamsLook({
    layout: pick(BEAM_LAYOUTS, random),
    sources: BEAM_SOURCES.filter((source) => chosen.includes(source)),
    marks: random() < 0.6 ? "plain" : "lettered",
    labels: random() < 0.75,
    traveller: pick(["review", "review", "card", "stream", "count", "pulse"] as const, random),
    landing: random() < 0.5 ? "dock" : "fade",
    line: random() < 0.6 ? "line" : "dots",
    carry: random() < 0.7 ? "each" : "together",
    colour: random() < 0.8 ? "brand" : "mono",
    glow: random() < 0.7 ? "source" : "acid",
    pace: between(0.8, 1.2, random),
  });
}
