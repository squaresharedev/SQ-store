import { HEADER_BIO_MAX, HEADER_NAME_MAX, type HeaderLine } from "@/types/storefront";

/**
 * The masthead's two lines are plain text, and they are typed in two places:
 * the panel's fields and the canvas itself. Both go through here, so a paste
 * that lands on the canvas is cleaned exactly like a paste into the panel and
 * neither can produce a value the server schema would reject.
 */

/** How long each line may be. The save path re-checks; this is the UX cap. */
export const HEADER_LINE_MAX: Record<HeaderLine, number> = {
  name: HEADER_NAME_MAX,
  bio: HEADER_BIO_MAX,
};

/** Only the bio is prose: the store name is one line by definition. */
export function headerLineAllowsNewlines(line: HeaderLine): boolean {
  return line === "bio";
}

/** Strip control characters (a newline survives where the line allows one),
 *  mirroring the server schema. */
export function sanitizeHeaderText(value: string, allowNewlines: boolean): string {
  return allowNewlines
    ? value.replace(/[\p{Cc}]/gu, (char) => (char === "\n" ? char : ""))
    : value.replace(/[\p{Cc}]/gu, "");
}

/** Sanitize and cap in one step, for the in-place editor: it reads whole
 *  strings back out of the DOM rather than one keystroke at a time. */
export function clampHeaderText(line: HeaderLine, value: string): string {
  return sanitizeHeaderText(value, headerLineAllowsNewlines(line)).slice(
    0,
    HEADER_LINE_MAX[line],
  );
}
