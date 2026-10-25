/**
 * A product name guessed from a photo's file name, or null when the name says
 * nothing a buyer would read.
 *
 * Sellers name their files after the thing more often than not
 * ("blue-ceramic-mug.jpg"), and a form that picks that up means the first
 * photo dropped has already filled in the first field. Camera and screenshot
 * names ("IMG_2041", "PXL_20260412_…", "Screenshot 2026-…") are not names, so
 * they guess nothing rather than a title the seller has to delete.
 *
 * Only ever a suggestion: the form uses it while the title is still empty.
 */

/** File names a camera, phone or OS made up, not a person. */
const GENERATED_NAME =
  /^(img|dsc|dscn|dscf|pxl|mvimg|photo|image|picture|pic|screenshot|screen shot|scan|whatsapp|wp|signal|snapchat|received|download|untitled|file|p)([\s_-]|\d|$)/i;

/** The longest guess worth offering; a sentence-long file name is not a title. */
const TITLE_GUESS_MAX = 80;

export function titleFromFileName(fileName: string): string | null {
  const stem = fileName.replace(/\.[a-z0-9]{2,5}$/i, "");
  if (GENERATED_NAME.test(stem)) return null;
  const words = stem
    // Separators to spaces, then camelCase apart ("blueMug" → "blue Mug").
    .replace(/[_\-.+]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    // A copy counter or a trailing number is never part of the name.
    .replace(/\s*\(\d+\)\s*$/, "")
    .replace(/(\s+\d+)+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  // Needs real words: three letters at least, and mostly letters.
  const letters = words.replace(/[^\p{L}]/gu, "").length;
  if (letters < 3 || letters < words.replace(/\s/g, "").length / 2) return null;
  if (words.length > TITLE_GUESS_MAX) return null;
  return words.charAt(0).toLocaleUpperCase() + words.slice(1);
}
