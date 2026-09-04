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

/** A one-click group: what it is called, how it should draw, and (where the
 *  values are genuinely standard) the values themselves. */
export type OptionGroupPreset = {
  name: string;
  display: OptionDisplay;
  /** Prefilled choices. Empty when the values are the seller's own — nobody
   *  else can guess a shop's colours, materials or wattages. */
  values: readonly string[];
  /** What the seller types into the value box first, when there is nothing to
   *  prefill. Concrete, so the shape of an answer is obvious. */
  placeholder: string;
};

export const OPTION_GROUP_PRESETS: readonly OptionGroupPreset[] = [
  { name: "Colour", display: "swatch", values: [], placeholder: "Midnight blue" },
  // The one axis with genuinely conventional values, so it is the one that
  // arrives filled in: a clothing seller adds sizes in a single click.
  { name: "Size", display: "chip", values: ["XS", "S", "M", "L", "XL", "XXL"], placeholder: "Medium" },
  { name: "Material", display: "chip", values: [], placeholder: "Solid oak" },
  { name: "Capacity", display: "chip", values: [], placeholder: "500 ml" },
  { name: "Power output", display: "chip", values: [], placeholder: "750 W" },
  { name: "Length", display: "chip", values: [], placeholder: "2 m" },
  { name: "Style", display: "chip", values: [], placeholder: "Wide fit" },
  { name: "Finish", display: "swatch", values: [], placeholder: "Brushed brass" },
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
  preset: OptionGroupPreset,
  mintId: () => string,
): ProductOptionGroup {
  return addOptions(
    { id: mintId(), name: preset.name, display: preset.display, options: [] },
    preset.values,
    mintId,
  );
}
