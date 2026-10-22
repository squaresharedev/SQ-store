import { hsvToHex, isLightColor, mixHex, readableInkOn } from "@/lib/format/color";
import type { SubjectColour } from "./cutout/analyze";

/**
 * A share card's colours, built from the PRODUCT's own colour so the card and
 * the thing on it belong together: the photo is the colour (styles.md §1),
 * the card only answers it. Pure, so the rules are unit tested.
 *
 * A template asks for a mood. `light` and `deep` stay in the product's hue (a
 * tint or a shade of it); `vivid` turns to the opposite hue, so the product
 * pops against its complement. A grey, black or white product has no hue to
 * build on, so each template names one to fall back to (SHARE_CARD_FALLBACK_HUES),
 * and a monochrome product still gets a card with some life in it.
 */

export type ShareCardMood = "light" | "deep" | "vivid";

export type ShareCardPalette = {
  /** The card's backdrop. */
  ground: string;
  /** Type and marks on the ground. */
  ink: string;
  /** Quieter type and hairlines on the ground. */
  soft: string;
  /** A stamp, a pill, a sticker: the one loud spot. */
  accent: string;
  /** Type on the accent. */
  accentInk: string;
};

/**
 * Hues (degrees) a template falls back to for a product with no colour of
 * its own. Warm cream, cobalt, signal orange, sage, deep teal and sun
 * yellow: one each, so six templates never look like one. No purple, which
 * is the brand's reserved accent (styles.md §2.4).
 */
export const SHARE_CARD_FALLBACK_HUES = {
  cream: 36,
  cobalt: 222,
  signal: 14,
  sage: 140,
  teal: 188,
  sun: 46,
} as const;

/** Saturation and value (0-100) of each mood's ground. */
const GROUND = {
  light: { s: 14, v: 96 },
  deep: { s: 58, v: 20 },
  vivid: { s: 78, v: 94 },
} as const;

/** Ink on a light ground: the hue, almost black. On a dark one: almost white. */
const INK_ON_LIGHT = { s: 72, v: 15 };
const INK_ON_DARK = { s: 6, v: 98 };

/** How far the soft ink sits from the ink toward the ground. */
const SOFT_MIX = 0.42;

export function shareCardPalette(
  colour: SubjectColour | null,
  mood: ShareCardMood,
  fallbackHue: number,
): ShareCardPalette {
  const own = colour?.colourful ? colour.hsv.h : fallbackHue;
  const h = mood === "vivid" && colour?.colourful ? (own + 180) % 360 : own;
  const ground = hsvToHex({ h, ...GROUND[mood] });
  const lightGround = isLightColor(ground);
  const ink = hsvToHex({ h, ...(lightGround ? INK_ON_LIGHT : INK_ON_DARK) });
  // The accent: on a calm ground, the hue at full strength; on a vivid one,
  // the ink, which is the strongest thing that ground can carry.
  const accent =
    mood === "vivid"
      ? ink
      : hsvToHex({ h: (h + 24) % 360, s: 78, v: lightGround ? 72 : 96 });
  return {
    ground,
    ink,
    soft: mixHex(ink, ground, SOFT_MIX),
    accent,
    accentInk: mood === "vivid" ? ground : readableInkOn(accent),
  };
}
