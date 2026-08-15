// The FIXED swatches shown inline in every color field, and the only colors in
// the picker that never change. Deliberately just three: the two ends of the
// neutral range and one grey between them.
//
// Three, not a ramp. Neutrals are the one thing a seller reaches for from
// memory rather than from context, so they earn permanent slots — but only a
// handful. Every extra grey here is a slot taken from the SUGGESTED row
// (lib/theme/palette.ts), which shows colors this storefront already uses, ones
// the seller picked recently, and recommendations. Those are what make the row
// worth its space; a fourth and fifth grey were not.
//
// Every entry is a literal 6-digit hex, so selecting one can only ever yield a
// value the strict hex contract (lib/validation/storefront.ts) accepts. Ink is
// the black rather than #000000 because it is already what
// DEFAULT_STOREFRONT_CONFIG.accent, DEFAULT_TEXT_COLOR and DEFAULT_BORDER_COLOR
// hold — a different black would leave every default sitting on a color the row
// does not offer.
//
// All three are a strict SUBSET of the panel's standard grid
// (standard-colors.ts), and a unit test holds them to it. A shortcut that hands
// out a grey the grid does not contain would make the same tap mean two things
// depending on where you took it from.
//
// Raw hex is permitted in THIS file alone — it is a token-definition module
// (like globals.css @theme and storefront/background-presets.ts), not a
// component. Components import the list; they never inline colors.

export type ColorPreset = { name: string; value: string };

export const COLOR_PRESETS: readonly ColorPreset[] = [
  { name: "White", value: "#ffffff" },
  { name: "Grey", value: "#737373" },
  { name: "Ink", value: "#171717" },
] as const;

/** Fast membership test for the fixed swatches, so the suggested row never
 *  repeats a color the row above it already shows. */
export function isFixedPreset(hex: string): boolean {
  return COLOR_PRESETS.some((preset) => preset.value === hex);
}
