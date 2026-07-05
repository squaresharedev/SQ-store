// Shared color swatch allowlist. The ColorPicker surfaces these as one-tap
// "known-safe" values; the storefront accent field is intended to adopt the
// SAME list in a later step (see docs/pickers.md → Adoption). Every entry is a
// literal 6-digit hex, so selecting a preset can only ever yield a value the
// strict hex contract (lib/validation/storefront.ts) accepts.
//
// Raw hex is permitted in THIS file alone — it is a token-definition module
// (like globals.css @theme and storefront/background-presets.ts), not a
// component. Components import the list; they never inline colors.

export type ColorPreset = { name: string; value: string };

export const COLOR_PRESETS: readonly ColorPreset[] = [
  { name: "Ink", value: "#171717" },
  { name: "Slate", value: "#475569" },
  { name: "Stone", value: "#78716c" },
  { name: "Red", value: "#ef4444" },
  { name: "Orange", value: "#f97316" },
  { name: "Amber", value: "#f59e0b" },
  { name: "Green", value: "#16a34a" },
  { name: "Teal", value: "#14b8a6" },
  { name: "Sky", value: "#0ea5e9" },
  { name: "Blue", value: "#2563eb" },
  { name: "Purple", value: "#a855f7" },
  { name: "Pink", value: "#ec4899" },
] as const;

export const COLOR_PRESET_VALUES: readonly string[] = COLOR_PRESETS.map(
  (preset) => preset.value,
);

export function isColorPreset(value: string): boolean {
  return COLOR_PRESET_VALUES.includes(value.toLowerCase());
}
