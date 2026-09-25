import { oneTimeCode, singleLineText, uuidField } from "@/lib/validation/inputs";

/**
 * Two-factor inputs. The server boundary: every 2FA action re-parses through
 * these, whatever the form in the browser already checked.
 */

/** What someone calls an authenticator ("Pixel 8", "Work phone"). GoTrue
 *  requires it to be unique per account; the action handles that clash. */
export const FACTOR_NAME_MAX = 40;
export const factorNameSchema = singleLineText({
  field: "factorName",
  max: FACTOR_NAME_MAX,
});

/** A six-digit authenticator code, spaces tolerated. */
export const totpCodeSchema = oneTimeCode("authenticator");

/** A factor id as GoTrue minted it. Always checked against the caller's OWN
 *  factor list as well; being a well-formed uuid proves nothing about whose. */
export const factorIdSchema = uuidField("factor");

/** Longest thing the recovery-code box will even look at (a 16-character code
 *  with dashes and stray spaces fits many times over). Anything past it is
 *  refused before any hashing or database work. */
export const RECOVERY_CODE_INPUT_MAX = 64;
