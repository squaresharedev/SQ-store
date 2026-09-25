import {
  OPTIONS_PER_GROUP_MAX,
  type OptionDisplay,
  type ProductOption,
  type ProductOptionGroup,
} from "@/types/product";

// The defaults that make option groups quick to set up. Client-safe: nothing
// here touches the server, and every value it produces still goes through
// productWriteSchema like any other input.
//
// PRESETS ARE A STARTING POINT, NEVER A LIST OF WHAT IS ALLOWED. The whole
// reason options are seller-defined is that we cannot know what a seller sells
// along — "Power output", "Nib width", "Rope length", "Roast" are all real
// axes. So these are one-click shortcuts for the axes most shops share, and
// "Something else" is a first-class row beside them, not a fallback.

/**
 * A one-click group: which axis it is, how it should draw, and (where the
 * values are genuinely standard) the values themselves.
 *
 * The axis NAME and the example the value box shows are copy, in the seller's
 * language (`Products.optionsField.presets.<id>`). The name a click writes into
 * the group is seller data from then on, like any name they typed.
 */
export type OptionGroupPreset = {
  id: OptionGroupPresetId;
  display: OptionDisplay;
  /** Prefilled choices. Empty when the values are the seller's own — nobody
   *  else can guess a shop's colours, materials or wattages. */
  values: readonly string[];
};

export type OptionGroupPresetId =
  | "colour"
  | "size"
  | "material"
  | "capacity"
  | "powerOutput"
  | "length"
  | "style"
  | "finish";

export const OPTION_GROUP_PRESETS: readonly OptionGroupPreset[] = [
  { id: "colour", display: "swatch", values: [] },
  // The one axis with genuinely conventional values, so it is the one that
  // arrives filled in: a clothing seller adds sizes in a single click.
  { id: "size", display: "chip", values: ["XS", "S", "M", "L", "XL", "XXL"] },
  { id: "material", display: "chip", values: [] },
  { id: "capacity", display: "chip", values: [] },
  { id: "powerOutput", display: "chip", values: [] },
  { id: "length", display: "chip", values: [] },
  { id: "style", display: "chip", values: [] },
  { id: "finish", display: "swatch", values: [] },
];

/**
 * How a group named `name` should draw before the seller says otherwise.
 *
 * Swatches only for axes that are literally about appearance, because a swatch
 * with no colour set is a letter in a grey circle — worse than the word it
 * replaced. Everything else is a chip: "750 W" and "XL" are read, not seen.
 */
export function defaultDisplayFor(name: string): OptionDisplay {
  return /colou?r|shade|finish|tone|fabric|pattern/i.test(name.trim()) ? "swatch" : "chip";
}

/**
 * One typed line to a list of option names.
 *
 * PASTE IS THE FAST PATH. Typing six sizes one at a time is six interactions;
 * pasting "XS, S, M, L, XL, XXL" is one, and it is how the values already
 * exist in a seller's spreadsheet, supplier sheet or old listing. Commas,
 * newlines and tabs all split, so a paste out of a spreadsheet column works
 * exactly as well as a typed line.
 *
 * Note that "/" is deliberately NOT a separator: "230/240 V" is one option.
 */
export function splitOptionInput(raw: string): string[] {
  return raw
    .split(/[,\n\r\t;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Add names to a group, skipping duplicates (case-insensitively — "Blue" and
 * "blue" are one colour, and a buyer shown both would not know the difference)
 * and stopping at the per-group cap.
 */
export function addOptions(
  group: ProductOptionGroup,
  names: readonly string[],
  mintId: () => string,
): ProductOptionGroup {
  const taken = new Set(group.options.map((option) => option.name.trim().toLowerCase()));
  const added: ProductOption[] = [];
  for (const name of names) {
    const key = name.toLowerCase();
    if (taken.has(key)) continue;
    if (group.options.length + added.length >= OPTIONS_PER_GROUP_MAX) break;
    taken.add(key);
    added.push({ id: mintId(), name, available: true });
  }
  return added.length > 0 ? { ...group, options: [...group.options, ...added] } : group;
}

/** A new group from a preset, ids minted by the caller so tests can be
 *  deterministic and the browser can use crypto.randomUUID. */
export function groupFromPreset(
  preset: { name: string; display: OptionDisplay; values: readonly string[] },
  mintId: () => string,
): ProductOptionGroup {
  return addOptions(
    { id: mintId(), name: preset.name, display: preset.display, options: [] },
    preset.values,
    mintId,
  );
}
