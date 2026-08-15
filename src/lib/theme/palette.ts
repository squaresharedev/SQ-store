import type {
  StorefrontBlock,
  StorefrontHeader,
  StorefrontTheme,
} from "@/types/storefront";
import { isStrictHexColor } from "@/lib/validation/storefront";

/**
 * The colors a storefront is ALREADY wearing — what the ColorPanel shows under
 * "In this design".
 *
 * Pure and React-free, so it is unit-testable and safe on either side.
 */

/**
 * Every color the config actually holds, in a stable order: the theme first,
 * then blocks in array order. Deduped and lowercased.
 *
 * ORDER MATTERS and must not become frequency-based. These swatches sit under
 * the seller's cursor while they edit; a row that re-sorts itself as a color's
 * usage count changes would move the swatch they were about to click.
 *
 * Configs are schema-validated on save, but they arrive here having been parsed
 * out of a jsonb column, so every value is re-gated rather than trusted — these
 * end up in a style attribute.
 */
export function collectStorefrontColors(
  theme: StorefrontTheme,
  blocks: readonly StorefrontBlock[],
  header?: StorefrontHeader,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  function add(hex: string | undefined) {
    if (!hex) return;
    const lower = hex.toLowerCase();
    if (!isStrictHexColor(lower) || seen.has(lower)) return;
    seen.add(lower);
    out.push(lower);
  }

  add(theme.accent);
  // An image background carries an object key and no hex, so it contributes
  // nothing — the neutral base behind it is chrome, not a seller's choice.
  if (theme.background.kind === "solid") add(theme.background.color);
  if (theme.background.kind === "gradient") {
    add(theme.background.from);
    add(theme.background.to);
  }

  // The masthead sits above the grid and is part of the same design; its two
  // lines only contribute when they carry a color of their own (inheriting adds
  // nothing new — the accent is already here).
  add(header?.nameColor);
  add(header?.bioColor);

  for (const block of blocks) {
    if (block.type === "shape") {
      add(block.color);
      add(block.borderColor);
    } else if (block.type === "text") {
      add(block.color);
    }
    // Product blocks hold no colors of their own — they follow the theme.
  }

  return out;
}
