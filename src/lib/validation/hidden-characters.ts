// Characters that are in the text but not on the screen.
//
// A person reading a listing cannot see them; a language model reading the same
// text can (a search engine's, a buyer's assistant, our own moderation check).
// So text carrying them can say one thing to people and another to an AI, or
// hide a word from a filter by splitting it. One place for which ones those
// are: the form drops them (lib/validation/inputs.ts), and the moderation check
// holds text that still carries them for a person (lib/moderation/auto/injection.ts).
//
// Pure and import-free.

/** Direction embeddings, overrides and isolates: they reverse how the rest of
 *  a line reads. Direction MARKS (U+200E, U+200F) are left alone. */
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/u;
const BIDI_CONTROLS_ALL = /[\u202A-\u202E\u2066-\u2069]/gu;

/** Zero-width space, word joiner, the invisible maths operators and a stray
 *  byte-order mark. Joiners (U+200C, U+200D) are NOT here: emoji and several
 *  scripts are built from them. */
const INVISIBLE_SPACERS_ALL = /[\u200B\u2060-\u2064\uFEFF]/gu;

/**
 * Unicode TAG characters (U+E0000 to U+E007F), invisible everywhere and read as
 * text by a language model: the known way to hide an instruction inside a
 * harmless-looking string. Their one legitimate use is a subdivision flag
 * (🏴 followed by tag letters and CANCEL TAG: Scotland, Wales, England), which
 * is matched first and kept whole.
 */
const FLAG_OR_TAG_ALL = /(\u{1F3F4}[\u{E0061}-\u{E007A}]{2,6}\u{E007F})|[\u{E0000}-\u{E007F}]/gu;
const SUBDIVISION_FLAGS_ALL = /\u{1F3F4}[\u{E0061}-\u{E007A}]{2,6}\u{E007F}/gu;
const TAG_CHARACTER = /[\u{E0000}-\u{E007F}]/u;

/**
 * Variation selectors used to carry data: any from the supplement block
 * (U+E0100 to U+E01EF), or a run of the ordinary ones. Text in the platform's
 * languages uses at most one U+FE0F after an emoji.
 */
const SUPPLEMENTARY_SELECTORS_ALL = /[\u{E0100}-\u{E01EF}]/gu;
const SMUGGLED_SELECTORS = /[\u{E0100}-\u{E01EF}]|[\uFE00-\uFE0F]{2,}/u;

/** Remove the direction controls only. */
export function dropBidiControls(value: string): string {
  return value.replace(BIDI_CONTROLS_ALL, "");
}

/**
 * Remove every character that has no job in a name, a description or an
 * address and can only hide text: direction controls, zero-width spaces and
 * word joiners, tag characters (a subdivision flag keeps its own) and the
 * supplementary variation selectors. Dropped, not refused: nobody can see the
 * character an error would be about.
 */
export function dropHiddenCharacters(value: string): string {
  return dropBidiControls(value)
    .replace(INVISIBLE_SPACERS_ALL, "")
    .replace(SUPPLEMENTARY_SELECTORS_ALL, "")
    .replace(FLAG_OR_TAG_ALL, (_match, flag: string | undefined) => flag ?? "");
}

/**
 * Whether text carries characters that hide or reverse it: a tag character
 * outside a subdivision flag, a direction control, or smuggled variation
 * selectors. The form drops all of them, so stored text that still has one was
 * written around the app.
 */
export function hasHiddenCharacters(value: string): boolean {
  return (
    TAG_CHARACTER.test(value.replace(SUBDIVISION_FLAGS_ALL, "")) ||
    BIDI_CONTROLS.test(value) ||
    SMUGGLED_SELECTORS.test(value)
  );
}
