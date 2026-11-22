import type { CSSProperties } from "react";
import { FONT_PAIRINGS, type FontPairing, type FontRole } from "@/types/storefront";
import { FONT_ROLE_VARS, fontRoleStyle } from "./font-roles";

/**
 * THE FONT PAIRINGS, as data: which two faces each one is, and how a board
 * names them. No React and no font loading here (that is app/fonts/
 * pairing-faces, which only the Next compiler can run), so the tests, the
 * renderers and the editor all read the same table.
 *
 * Every face is OFL-licensed and served from this app's own origin (LICENSES.md
 * in app/fonts). A seller picks a pairing by name, never two fonts.
 */

/** Every face a pairing can use. */
export const PAIRING_FACES = [
  "fraunces",
  "playfair",
  "sourceSans",
  "dmSerif",
  "dmSans",
  "instrumentSerif",
  "manrope",
  "inter",
  "spaceGrotesk",
] as const;
export type PairingFace = (typeof PAIRING_FACES)[number];

/** Which face each pairing sets its headings and its body text in. */
export const FONT_PAIRING_FACES: Record<FontPairing, Record<FontRole, PairingFace>> = {
  editorial: { heading: "fraunces", body: "inter" },
  classic: { heading: "playfair", body: "sourceSans" },
  modern: { heading: "spaceGrotesk", body: "inter" },
  soft: { heading: "dmSerif", body: "dmSans" },
  studio: { heading: "instrumentSerif", body: "manrope" },
};

/**
 * The CSS variables each face's family names live in: its Latin face and its
 * Latin Extended face (see app/fonts/pairing-faces, which declares them; a
 * unit test holds the two lists to each other). Inter and Space Grotesk's
 * Latin halves are the root layout's own variables.
 */
export const PAIRING_FACE_VARS: Record<PairingFace, { latin: string; ext: string }> = {
  fraunces: { latin: "--font-pair-fraunces", ext: "--font-pair-fraunces-ext" },
  playfair: { latin: "--font-pair-playfair", ext: "--font-pair-playfair-ext" },
  sourceSans: { latin: "--font-pair-source-sans", ext: "--font-pair-source-sans-ext" },
  dmSerif: { latin: "--font-pair-dm-serif", ext: "--font-pair-dm-serif-ext" },
  dmSans: { latin: "--font-pair-dm-sans", ext: "--font-pair-dm-sans-ext" },
  instrumentSerif: { latin: "--font-pair-instrument-serif", ext: "--font-pair-instrument-serif-ext" },
  manrope: { latin: "--font-pair-manrope", ext: "--font-pair-manrope-ext" },
  inter: { latin: "--font-inter", ext: "--font-pair-inter-ext" },
  spaceGrotesk: { latin: "--font-space-grotesk", ext: "--font-pair-space-grotesk-ext" },
};

/** What a face's characters fall back to while it loads (and for anything
 *  neither of its files carries). */
const SERIF_FALLBACK = "Georgia, ui-serif, serif";
const SANS_FALLBACK = "ui-sans-serif, system-ui, sans-serif";
const SERIF_FACES: ReadonlySet<PairingFace> = new Set(["fraunces", "playfair", "dmSerif", "instrumentSerif"]);

/**
 * One face as a font-family value. The Extended face comes FIRST: its
 * unicode-range keeps it to the characters the Latin face lacks (č, ł, ő ...),
 * so plain Latin text walks past it to the Latin face, and a browser fetches
 * the Extended file only for words that need it. The other way round, the
 * Latin face's own metric-matched fallback would answer for those characters
 * first and the Extended face would never be reached.
 */
export function pairingFaceStack(face: PairingFace): string {
  const vars = PAIRING_FACE_VARS[face];
  return `var(${vars.ext}), var(${vars.latin}), ${SERIF_FACES.has(face) ? SERIF_FALLBACK : SANS_FALLBACK}`;
}

/**
 * The board root's contribution for a pairing: the two role variables
 * (FONT_ROLE_VARS, read through fontRoleStyle by anything set in one face),
 * and the body face as the board's own font, so every word that asks for
 * nothing reads in it.
 */
export function fontPairingStyle(pairing: FontPairing): CSSProperties {
  const faces = FONT_PAIRING_FACES[pairing];
  return {
    [FONT_ROLE_VARS.heading]: pairingFaceStack(faces.heading),
    [FONT_ROLE_VARS.body]: pairingFaceStack(faces.body),
    fontFamily: `var(${FONT_ROLE_VARS.body})`,
  } as CSSProperties;
}

/**
 * The masthead's store name is the storefront's own headline, so under a
 * pairing it wears the headline face (the bio, like any other words, already
 * reads in the body face the board is set in). Undefined when the line has a
 * font of its own, for the bio, and without a pairing: the masthead then
 * renders exactly as it did.
 */
export function headerLinePairingFont(
  theme: { fontPairing?: string },
  line: "name" | "bio",
  ownFont: string | undefined,
): { className?: string; style: CSSProperties } | undefined {
  if (line !== "name" || ownFont !== undefined || !isFontPairing(theme.fontPairing)) return undefined;
  return { style: fontRoleStyle("heading") };
}

/** A stored value that names a pairing (configs arrive from a jsonb column). */
export function isFontPairing(value: unknown): value is FontPairing {
  return typeof value === "string" && (FONT_PAIRINGS as readonly string[]).includes(value);
}
