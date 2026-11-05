/**
 * Text someone else wrote, made safe to put in ONE log line.
 *
 * Public routes log what they were sent (the CSP report sink does), and the
 * logs are read by people and by alert rules keyed on fixed prefixes
 * ("[ops alert]", "[server error]"). So control characters (a newline would
 * start a line of the sender's own) and square brackets are percent-encoded,
 * which leaves a URL readable, and the text is cut to `max` characters. A cut
 * that splits a pair (an emoji) leaves half of it behind; that half becomes
 * U+FFFD, so the result is well-formed text and safe to encode further.
 */
const UNSAFE_IN_LOG = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\[\]]/g;

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function logSafe(value: string, max = 300): string {
  return value
    .slice(0, max)
    .replace(LONE_SURROGATE, "\uFFFD")
    .replace(UNSAFE_IN_LOG, (char) => encodeURIComponent(char));
}
