/**
 * Plain-text gates shared by every free-text field the user can write.
 *
 * Control characters are rejected outright; the multiline variant re-admits
 * only newline. These were previously defined inside the storefront schema and
 * so covered storefront text but NOT profile fields — display names reach
 * notification bodies today and email headers once invite mail is wired, where
 * an embedded CR/LF is header injection. Defined once here so a field can't be
 * added later that quietly skips the gate.
 *
 * This is hygiene, not the XSS defence: user text is always rendered as React
 * text nodes, never as markup.
 */

export const TEXT_ERROR = { error: "Text contains unsupported characters." };

/** Any run of non-control characters, plus newline. */
export const MULTILINE_TEXT_PATTERN = /^(?:[^\u0000-\u001f\u007f]|\n)*$/;

/** Non-control characters only — no newline, no carriage return, no NUL. */
export const SINGLE_LINE_TEXT_PATTERN = /^[^\u0000-\u001f\u007f]*$/;
