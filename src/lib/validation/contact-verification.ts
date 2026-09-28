import { z } from "zod";
import { CONTACT_CHANNELS, CONTACT_CODE_LENGTH } from "@/lib/contact-verification/policy";
import { oneTimeCode } from "@/lib/validation/inputs";

/**
 * Contact-verification inputs. The server boundary: both actions re-parse
 * through these whatever the browser already checked. Neither carries the
 * address or number being proven: the recipient is always read from the
 * stored profile, so a request can never aim a code at someone else.
 */

export const contactChannelSchema = z.enum(CONTACT_CHANNELS);

/** "Send me a code": which of my details, and nothing else. */
export const sendContactCodeSchema = z.strictObject({
  channel: contactChannelSchema,
});

/** "Here is the code": which detail, and the digits, spaces tolerated. */
export const confirmContactCodeSchema = z.strictObject({
  channel: contactChannelSchema,
  code: oneTimeCode("contact", CONTACT_CODE_LENGTH),
});
