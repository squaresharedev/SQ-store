/**
 * The canvases a product share card is drawn on: the shapes Instagram and the
 * other feeds crop to. Pure constants, safe on server and client.
 *
 * A card is LAID OUT at a small logical size (SHARE_CARD_WIDTH CSS pixels
 * wide) and exported at SHARE_CARD_EXPORT_SCALE times that, so the type and
 * spacing tokens the rest of the app uses read at the right size on a phone
 * feed: 360 laid out is 1080 exported, the width every one of these platforms
 * wants. One width, three heights, so a template only ever adapts vertically.
 */

/** Logical width every format is laid out at, in CSS pixels. */
export const SHARE_CARD_WIDTH = 360;

/** Pixel ratio of the exported image: 360 x 3 = 1080. */
export const SHARE_CARD_EXPORT_SCALE = 3;

export const SHARE_CARD_FORMATS = {
  /** A feed post, square: Instagram, Facebook, Threads, X. */
  square: { height: 360, ratio: "1:1" },
  /** A feed post, tall: Instagram's portrait crop, the most room in a feed. */
  portrait: { height: 450, ratio: "4:5" },
  /** A full-screen story or reel cover: Instagram, TikTok, WhatsApp status. */
  story: { height: 640, ratio: "9:16" },
} as const;

export type ShareCardFormat = keyof typeof SHARE_CARD_FORMATS;

export const SHARE_CARD_FORMAT_IDS = Object.keys(SHARE_CARD_FORMATS) as ShareCardFormat[];
