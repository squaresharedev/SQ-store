import { z } from "zod";
import {
  DELETE_CONFIRM_PHRASE,
  EU_COUNTRY_CODES,
  LEGAL_VERSION,
} from "@/lib/settings/constants";

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
  display_name: z
    .string()
    .trim()
    .min(1, "Give yourself a name, even a weird one.")
    .max(50, "Keep it under 50 characters."),
});

export const emailChangeSchema = z.strictObject({
  new_email: z
    .email("That doesn't look like an email address.")
    .max(254, "That email is too long."),
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
const optionalTrimmed = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} is too long.`)
    .transform((v) => (v === "" ? null : v));

export const taxSchema = z.strictObject({
  tax_business_name: optionalTrimmed(200, "Business name"),
  tax_vat_id: z
    .string()
    .trim()
    .regex(/^$|^[A-Za-z0-9 .-]{2,32}$/, "VAT IDs are 2 to 32 letters and digits.")
    .transform((v) => (v === "" ? null : v.toUpperCase())),
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
