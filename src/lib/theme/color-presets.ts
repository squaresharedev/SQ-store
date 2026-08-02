// The quick-pick swatches shown inline next to every color field. Deliberately
// SHORT: the inline row is meant to cover the common case in one tap, and
// anything else is one tap further via the picker's color wheel button. A long
// palette here would defeat the point of the compact row.
//
// A neutral ramp is what earns the space — most storefront chrome (text, rules,
// shape fills) is neutral, while accents are chosen once and then reused from
// the wheel. Every entry is a literal 6-digit hex, so selecting one can only
// ever yield a value the strict hex contract (lib/validation/storefront.ts)
// accepts.
//
// Raw hex is permitted in THIS file alone — it is a token-definition module
// (like globals.css @theme and storefront/background-presets.ts), not a
// component. Components import the list; they never inline colors.

export type ColorPreset = { name: string; value: string };

export const COLOR_PRESETS: readonly ColorPreset[] = [
  { name: "White", value: "#ffffff" },
  { name: "Silver", value: "#d6d3d1" },
  { name: "Stone", value: "#78716c" },
  { name: "Graphite", value: "#44403c" },
  { name: "Ink", value: "#171717" },
] as const;
