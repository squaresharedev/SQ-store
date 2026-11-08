import {
  PRODUCT_IMPORT_STORY_LOOK,
  STORY_COUNTS,
  STORY_CURSORS,
  STORY_FORMS,
  STORY_FRAMES,
  STORY_LANDINGS,
  STORY_LAYOUTS,
  STORY_LIFTS,
  STORY_MATERIALS,
  STORY_PACE,
  STORY_SHELVES,
  storyLook,
  type ProductImportStoryLook,
} from "@/components/products/product-import-story-tokens";
import { between, changedProps, decodeLabHash, encodeLabHash, pick, type LabFit } from "../lab-kit/state";

/**
 * The product import lab's model: the looks the graphic can try (its own
 * option lists, so the lab tunes what ships), where it is shown, the presets'
 * shape, and the state that lives in the address bar.
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
  look: Partial<ProductImportStoryLook>;
};

/** Every option, labelled for the panel, in the order the panel lists them. */
export const LAB_OPTIONS = {
  layout: STORY_LAYOUTS.map((value) => ({ value, label: { split: "Shelf beside", stack: "Shelf above" }[value] })),
  count: STORY_COUNTS.map((value) => ({ value: String(value), label: `${value} products` })),
  shelf: STORY_SHELVES.map((value) => ({
    value,
    label: { bookcase: "Bookcase", floating: "Floating boards", rack: "Open rack", cubbies: "Cubbies" }[value],
  })),
  material: STORY_MATERIALS.map((value) => ({ value, label: { oak: "Oak", walnut: "Walnut", white: "White", black: "Black" }[value] })),
  form: STORY_FORMS.map((value) => ({ value, label: { loose: "Cut-out products", tile: "Flat photos" }[value] })),
  cursor: STORY_CURSORS.map((value) => ({ value, label: { arrow: "Arrow", hand: "Hand" }[value] })),
  lift: STORY_LIFTS.map((value) => ({ value, label: { tilt: "Leans", float: "Floats" }[value] })),
  frame: STORY_FRAMES.map((value) => ({ value, label: { browser: "Browser window", app: "Square Share app" }[value] })),
  landing: STORY_LANDINGS.map((value) => ({ value, label: { settle: "Settles", ring: "Settles, ink ring" }[value] })),
} as const;

/** The knobs' ranges. */
export const LAB_KNOBS = {
  pace: { min: STORY_PACE.min, max: STORY_PACE.max, step: 0.05 },
} as const;

/** A preset's look over the default one, put right the way the graphic puts it right. */
export const withDefaults = (look: Partial<ProductImportStoryLook>): ProductImportStoryLook => storyLook(look);

/** The graphic as JSX to paste: only what differs from the default look. */
export function toJsx(look: ProductImportStoryLook): string {
  // Numbers to three places, so a slider's float noise never reaches the paste.
  const tidy = (_: string, value: unknown) => (typeof value === "number" ? Math.round(value * 1000) / 1000 : value);
  const changed = Object.entries(changedProps(PRODUCT_IMPORT_STORY_LOOK, look)).map(
    ([key, value]) => `${key}: ${JSON.stringify(value, tidy)}`,
  );
  return changed.length ? `<ProductImportStory look={{ ${changed.join(", ")} }} />` : "<ProductImportStory />";
}

/** The lab's state as it lives in the address bar, so a variation can be sent as a link. */
export type LabState = { look: ProductImportStoryLook; placement: LabPlacement; presetId: string | null };

export function encodeState(state: LabState): string {
  return encodeLabHash({
    look: changedProps(PRODUCT_IMPORT_STORY_LOOK, state.look),
    placement: state.placement,
    presetId: state.presetId,
  });
}

const oneOf = <T extends string | number>(list: readonly T[], value: unknown, fallback: T): T =>
  (list as readonly unknown[]).includes(value) ? (value as T) : fallback;

const numberOr = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/** Back from a link; anything unreadable falls back to the default look. */
export function decodeState(hash: string): LabState | null {
  const raw = decodeLabHash(hash);
  if (!raw) return null;
  const look = (raw.look && typeof raw.look === "object" ? raw.look : {}) as Partial<Record<keyof ProductImportStoryLook, unknown>>;
  const base = PRODUCT_IMPORT_STORY_LOOK;
  return {
    look: storyLook({
      layout: oneOf(STORY_LAYOUTS, look.layout, base.layout),
      count: oneOf(STORY_COUNTS, look.count, base.count),
      shelf: oneOf(STORY_SHELVES, look.shelf, base.shelf),
      material: oneOf(STORY_MATERIALS, look.material, base.material),
      form: oneOf(STORY_FORMS, look.form, base.form),
      cursor: oneOf(STORY_CURSORS, look.cursor, base.cursor),
      lift: oneOf(STORY_LIFTS, look.lift, base.lift),
      frame: oneOf(STORY_FRAMES, look.frame, base.frame),
      landing: oneOf(STORY_LANDINGS, look.landing, base.landing),
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

/** Somewhere new: any shelf in any material, either pointer, either frame. */
export function shuffle(random: () => number = Math.random): ProductImportStoryLook {
  return storyLook({
    layout: pick(STORY_LAYOUTS, random),
    count: pick(STORY_COUNTS, random),
    shelf: pick(STORY_SHELVES, random),
    material: pick(STORY_MATERIALS, random),
    form: pick(STORY_FORMS, random),
    cursor: pick(STORY_CURSORS, random),
    lift: pick(STORY_LIFTS, random),
    frame: pick(STORY_FRAMES, random),
    landing: pick(STORY_LANDINGS, random),
    pace: between(0.8, 1.2, random),
  });
}
