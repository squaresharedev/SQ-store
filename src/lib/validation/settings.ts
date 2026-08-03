import { z } from "zod";
import {
  DELETE_CONFIRM_PHRASE,
  DISPLAY_NAME_MAX_LENGTH,
  EU_COUNTRY_CODES,
  LEGAL_VERSION,
} from "@/lib/settings/constants";
import {
  emailAddress,
  optionalSingleLineText,
  referenceCode,
  singleLineText,
} from "@/lib/validation/inputs";

/**
 * Settings validation schemas, shared by the client (UX hints) and the server
 * actions (the real gate — every settings write re-validates here).
 *
 * SECURITY: these schemas double as the profile FIELD WHITELIST. Each write
 * schema enumerates exactly the editable columns for that form; the server
 * actions build DB updates only from parsed output, and separately reject any
 * unexpected submitted field. `id`, `is_seller`, `avatar_url`, timestamps and
 * anything role-like are not present in any schema and can never be written
 * through settings.
 */

export const displayNameSchema = z.strictObject({
  // A username is echoed into notification bodies and will reach invite email
  // headers, so the gate comes from the shared primitive. The length cap is
  // enforced HERE, on every server write path — the input's `maxLength` is a
  // typing hint only and a direct POST never sees it.
  display_name: singleLineText({
    label: "A username",
    max: DISPLAY_NAME_MAX_LENGTH,
  }),
});

/**
 * Changing the account email is a takeover-grade action: whoever controls the
 * address can request a password reset to it. So the current password is
 * required, exactly like a password change.
 *
 * Optional in the SCHEMA because accounts created through an OAuth provider
 * have no password to type; the action checks whether this account actually
 * has a password identity and enforces it there, where that is knowable.
 */
export const emailChangeSchema = z.strictObject({
  new_email: emailAddress("That email"),
  current_password: z.string().max(72).optional(),
});

export const passwordChangeSchema = z
  .strictObject({
    current_password: z.string().min(1, "Enter your current password."),
    new_password: z
      .string()
      .min(8, "New password needs at least 8 characters.")
      .max(72, "Keep it under 72 characters."),
    confirm_password: z.string(),
  })
  .refine((v) => v.new_password === v.confirm_password, {
    message: "New passwords do not match.",
    path: ["confirm_password"],
  });

/** Empty string means "not set" and is stored as NULL. */
/** Optional single-line free text. Control characters are rejected here so
 *  every field built on this helper inherits the gate (tax_business_name ends
 *  up on invoices and in tax exports). */
const optionalTrimmed = (max: number, label: string) =>
  optionalSingleLineText({ label, max }).transform((v) => (v === "" ? null : v));

export const taxSchema = z.strictObject({
  tax_business_name: optionalTrimmed(200, "Business name"),
  tax_vat_id: referenceCode({ label: "A VAT ID", min: 2, max: 32 }).transform(
    (v) => (v === "" ? null : v.toUpperCase()),
  ),
  tax_country: z
    .string()
    .refine((v) => v === "" || (EU_COUNTRY_CODES as string[]).includes(v), {
      message: "Pick a country from the list.",
    })
    .transform((v) => (v === "" ? null : v)),
});

export const notificationsSchema = z.strictObject({
  notify_sales: z.boolean(),
  notify_product_updates: z.boolean(),
  notify_marketing: z.boolean(),
});

/** Acceptance is only valid for the exact current version. */
export const legalAcceptSchema = z.strictObject({
  version: z.literal(LEGAL_VERSION, "The legal docs changed while you were reading. Reload and try again."),
});

/** Type-to-confirm gate for account deletion. */
export const deleteConfirmSchema = z.strictObject({
  confirm: z
    .string()
    .trim()
    .refine((v) => v.toLowerCase() === DELETE_CONFIRM_PHRASE, {
      message: `Type "${DELETE_CONFIRM_PHRASE}" exactly to confirm.`,
    }),
});
