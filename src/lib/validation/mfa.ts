import { oneTimeCode, singleLineText, uuidField } from "@/lib/validation/inputs";
import { issueKey } from "@/lib/validation/messages";
import { PASSKEY_FACTOR_PREFIX } from "@/lib/auth/assurance";

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
}).refine((value) => !value.toLowerCase().startsWith(PASSKEY_FACTOR_PREFIX), {
  // The prefix marks a passkey's factor at GoTrue (lib/auth/assurance.ts), so
  // an app may not borrow it and be shown as one.
  error: issueKey("Validation.text.factorName.reserved"),
});

/**
 * The browser's WebAuthn response, as JSON text. Its shape is checked by the
 * WebAuthn library; this only bounds how much text is even looked at.
 */
export const PASSKEY_CREDENTIAL_MAX = 16_000;

/** A six-digit authenticator code, spaces tolerated. */
export const totpCodeSchema = oneTimeCode("authenticator");

/** A factor id as GoTrue minted it. Always checked against the caller's OWN
 *  factor list as well; being a well-formed uuid proves nothing about whose. */
export const factorIdSchema = uuidField("factor");

/** Longest thing the recovery-code box will even look at (a 16-character code
 *  with dashes and stray spaces fits many times over). Anything past it is
 *  refused before any hashing or database work. */
export const RECOVERY_CODE_INPUT_MAX = 64;
