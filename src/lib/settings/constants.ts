// Shared constants for the settings slice.

import type { Locale } from "@/i18n/locales";

/**
 * Version tag recorded when a user agrees to the Terms of Service (the welcome
 * flow's terms step, or Settings › Legal). It names WHICH Terms were agreed to:
 * the full document's "last updated" date (TERMS_LAST_UPDATED in
 * lib/legal/terms-summary.ts). Bump both together whenever the Terms change;
 * anyone who agreed to an older version is asked again (the Overview attention
 * row). Capped at 32 characters by a DB CHECK.
 */
export const LEGAL_VERSION = "tos-2026-09-09";

// The account's name bounds live with the rest of the handle rules, in
// lib/validation/auth.ts (USERNAME_MIN_LENGTH / USERNAME_MAX_LENGTH). They are
// not repeated here: one identifier, one place that says how long it may be.

/**
 * The phrase a user types to confirm account deletion, in each UI language.
 * The form shows the one for the language it renders in.
 */
export const DELETE_CONFIRM_PHRASES: Record<Locale, string> = {
  en: "delete my account",
  cs: "smazat můj účet",
  de: "mein Konto löschen",
  fr: "supprimer mon compte",
  es: "eliminar mi cuenta",
  it: "elimina il mio account",
  nl: "mijn account verwijderen",
  pl: "usuń moje konto",
  "pt-PT": "eliminar a minha conta",
  sk: "zmazať môj účet",
};

/** Combining marks, as left behind by NFD: the accent in "ů", the caron in "č". */
const COMBINING_MARKS = /\p{M}/gu;

function normalizePhrase(value: string): string {
  return value.trim().normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();
}

const ACCEPTED_DELETE_PHRASES = new Set(
  Object.values(DELETE_CONFIRM_PHRASES).map(normalizePhrase),
);

/**
 * Does this typed text confirm deletion? THE one test, used by the form's
 * button and by the server's schema alike.
 *
 * Any supported language's phrase is accepted, not only the one on screen. The
 * locale can change between render and submit (another tab, a cookie that
 * differs from the profile), and the phrase is a deliberate speed bump rather
 * than a secret, so refusing a correct phrase in the "wrong" language would
 * only lock someone out of deleting their own account.
 *
 * Case and accents are ignored on both sides. Plenty of Czech and Slovak
 * sellers type on an English layout where "ů" and "č" are awkward to reach, and
 * "smazat muj ucet" is just as deliberate as "smazat můj účet". Decomposing
 * first also makes a composed and a decomposed "ů" compare equal.
 */
export function isDeleteConfirmPhrase(value: string): boolean {
  return ACCEPTED_DELETE_PHRASES.has(normalizePhrase(value));
}

/**
 * EU member states for the tax section (ISO 3166-1 alpha-2). Also the
 * trader-identity country list: an EU country here is what makes
 * `isEuSeller` (lib/storefront/product-page.ts) add the statutory
 * withdrawal/conformity lines to a product page.
 */
export const EU_COUNTRIES = [
  { code: "AT", name: "Austria" },
  { code: "BE", name: "Belgium" },
  { code: "BG", name: "Bulgaria" },
  { code: "HR", name: "Croatia" },
  { code: "CY", name: "Cyprus" },
  { code: "CZ", name: "Czechia" },
  { code: "DK", name: "Denmark" },
  { code: "EE", name: "Estonia" },
  { code: "FI", name: "Finland" },
  { code: "FR", name: "France" },
  { code: "DE", name: "Germany" },
  { code: "GR", name: "Greece" },
  { code: "HU", name: "Hungary" },
  { code: "IE", name: "Ireland" },
  { code: "IT", name: "Italy" },
  { code: "LV", name: "Latvia" },
  { code: "LT", name: "Lithuania" },
  { code: "LU", name: "Luxembourg" },
  { code: "MT", name: "Malta" },
  { code: "NL", name: "Netherlands" },
  { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" },
  { code: "RO", name: "Romania" },
  { code: "SK", name: "Slovakia" },
  { code: "SI", name: "Slovenia" },
  { code: "ES", name: "Spain" },
  { code: "SE", name: "Sweden" },
] as const;

export const EU_COUNTRY_CODES = EU_COUNTRIES.map((c) => c.code);

/** Field caps for the account-level seller/trader identity (business name
 *  lives on `tax_business_name`, capped separately at 200 — see taxSchema).
 *  Mirrors what the DB CHECKs on profiles.seller_address/seller_phone allow;
 *  keep the two in step. */
export const SELLER_FIELD_MAX = {
  address: 300,
  phone: 32,
} as const;

/** Cap for the account's public bio (Settings › Account, `profiles.seller_bio`
 *  despite the name — see updateBio in lib/settings/actions.ts for why the
 *  column name and the setting's home have drifted apart). Mirrors the DB
 *  CHECK on profiles.seller_bio; keep the two in step. */
export const BIO_MAX = 100;
