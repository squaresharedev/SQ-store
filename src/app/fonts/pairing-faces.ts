import localFont from "next/font/local";
import type { PairingFace } from "@/lib/theme/font-pairings";

// THE FONT PAIRINGS' FACES (lib/theme/font-pairings), self-hosted. Where each
// file came from and under which license: LICENSES.md beside this file.
//
// DECLARED HERE, NOT IN THE ROOT LAYOUT. This module is imported only by what
// draws a storefront (lib/theme/font-pairing-presentation), so its @font-face
// rules ship with the board routes (the hosted page, the embed frame, the
// designer, the product page, the previews) and with nothing else: the
// dashboard never carries them.
//
// AND NOTHING IS FETCHED UNTIL IT IS USED. `preload: false` on every face: a
// browser downloads a web font only when some text on screen is set in it, and
// a board only names these families when it has a pairing (the board root then
// carries the two faces' variable classes and the role variables). A board with
// no pairing names none of them, so it downloads nothing new.
//
// TWO FILES PER FACE: the Latin subset, and the Latin Extended one (Czech,
// Polish, Slovak, ...) as a face of its own with a unicode-range, which the
// browser fetches only when the words on screen actually need one of its
// characters. That is exactly how the upstream subsets are meant to be served;
// next/font/local cannot give one family two unicode-ranges, so the board's
// font stack names both (font-pairings, `pairingFaceStack`), the Extended face
// first. Inter's and Space Grotesk's Latin files are the ones the root layout
// already loads; only their Extended halves are new.
//
// The variable names are mirrored in lib/theme/font-pairings (PAIRING_FACE_VARS)
// and a unit test holds the two to each other. Every value below is a literal
// because next/font requires literals: the unicode-range is repeated for that
// reason, not by choice.
//
// Static faces (DM Serif Display, Instrument Serif) ship one weight, declared
// across the whole weight range so a heading's semibold never makes the
// browser smear a fake bold over a display face.

const fraunces = localFont({
  src: [
    { path: "./pairings/fraunces-latin-opsz-normal.woff2", weight: "100 900", style: "normal" },
    { path: "./pairings/fraunces-latin-opsz-italic.woff2", weight: "100 900", style: "italic" },
  ],
  variable: "--font-pair-fraunces",
  display: "swap",
  preload: false,
  adjustFontFallback: "Times New Roman",
});
const frauncesExt = localFont({
  src: [
    { path: "./pairings/fraunces-latin-ext-opsz-normal.woff2", weight: "100 900", style: "normal" },
    { path: "./pairings/fraunces-latin-ext-opsz-italic.woff2", weight: "100 900", style: "italic" },
  ],
  variable: "--font-pair-fraunces-ext",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" }],
});

const playfair = localFont({
  src: [
    { path: "./pairings/playfair-display-latin-wght-normal.woff2", weight: "400 900", style: "normal" },
    { path: "./pairings/playfair-display-latin-wght-italic.woff2", weight: "400 900", style: "italic" },
  ],
  variable: "--font-pair-playfair",
  display: "swap",
  preload: false,
  adjustFontFallback: "Times New Roman",
});
const playfairExt = localFont({
  src: [
    { path: "./pairings/playfair-display-latin-ext-wght-normal.woff2", weight: "400 900", style: "normal" },
    { path: "./pairings/playfair-display-latin-ext-wght-italic.woff2", weight: "400 900", style: "italic" },
  ],
  variable: "--font-pair-playfair-ext",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" }],
});

const sourceSans = localFont({
  src: "./pairings/source-sans-3-latin-wght-normal.woff2",
  weight: "200 900",
  variable: "--font-pair-source-sans",
  display: "swap",
  preload: false,
});
const sourceSansExt = localFont({
  src: "./pairings/source-sans-3-latin-ext-wght-normal.woff2",
  weight: "200 900",
  variable: "--font-pair-source-sans-ext",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" }],
});

const dmSerif = localFont({
  src: [
    { path: "./pairings/dm-serif-display-latin-400-normal.woff2", weight: "100 900", style: "normal" },
    { path: "./pairings/dm-serif-display-latin-400-italic.woff2", weight: "100 900", style: "italic" },
  ],
  variable: "--font-pair-dm-serif",
  display: "swap",
  preload: false,
  adjustFontFallback: "Times New Roman",
});
const dmSerifExt = localFont({
  src: [
    { path: "./pairings/dm-serif-display-latin-ext-400-normal.woff2", weight: "100 900", style: "normal" },
    { path: "./pairings/dm-serif-display-latin-ext-400-italic.woff2", weight: "100 900", style: "italic" },
  ],
  variable: "--font-pair-dm-serif-ext",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" }],
});

const dmSans = localFont({
  src: "./pairings/dm-sans-latin-wght-normal.woff2",
  weight: "100 1000",
  variable: "--font-pair-dm-sans",
  display: "swap",
  preload: false,
});
const dmSansExt = localFont({
  src: "./pairings/dm-sans-latin-ext-wght-normal.woff2",
  weight: "100 1000",
  variable: "--font-pair-dm-sans-ext",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" }],
});

const instrumentSerif = localFont({
  src: [
    { path: "./pairings/instrument-serif-latin-400-normal.woff2", weight: "100 900", style: "normal" },
    { path: "./pairings/instrument-serif-latin-400-italic.woff2", weight: "100 900", style: "italic" },
  ],
  variable: "--font-pair-instrument-serif",
  display: "swap",
  preload: false,
  adjustFontFallback: "Times New Roman",
});
const instrumentSerifExt = localFont({
  src: [
    { path: "./pairings/instrument-serif-latin-ext-400-normal.woff2", weight: "100 900", style: "normal" },
    { path: "./pairings/instrument-serif-latin-ext-400-italic.woff2", weight: "100 900", style: "italic" },
  ],
  variable: "--font-pair-instrument-serif-ext",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" }],
});

const manrope = localFont({
  src: "./pairings/manrope-latin-wght-normal.woff2",
  weight: "200 800",
  variable: "--font-pair-manrope",
  display: "swap",
  preload: false,
});
const manropeExt = localFont({
  src: "./pairings/manrope-latin-ext-wght-normal.woff2",
  weight: "200 800",
  variable: "--font-pair-manrope-ext",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" }],
});

// Only the Extended halves: the Latin files are the root layout's own.
const interExt = localFont({
  src: "./pairings/inter-latin-ext-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-pair-inter-ext",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" }],
});
const spaceGroteskExt = localFont({
  src: "./pairings/space-grotesk-latin-ext-wght-normal.woff2",
  weight: "300 700",
  variable: "--font-pair-space-grotesk-ext",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" }],
});

/**
 * The classes that DECLARE each face's CSS variables (next/font's `variable`
 * class). Put on the element a pairing is drawn in, they make the family names
 * the role variables point at resolvable there. Declaring a family downloads
 * nothing by itself.
 */
export const PAIRING_FACE_CLASSES: Record<PairingFace, string> = {
  fraunces: `${fraunces.variable} ${frauncesExt.variable}`,
  playfair: `${playfair.variable} ${playfairExt.variable}`,
  sourceSans: `${sourceSans.variable} ${sourceSansExt.variable}`,
  dmSerif: `${dmSerif.variable} ${dmSerifExt.variable}`,
  dmSans: `${dmSans.variable} ${dmSansExt.variable}`,
  instrumentSerif: `${instrumentSerif.variable} ${instrumentSerifExt.variable}`,
  manrope: `${manrope.variable} ${manropeExt.variable}`,
  inter: interExt.variable,
  spaceGrotesk: spaceGroteskExt.variable,
};
