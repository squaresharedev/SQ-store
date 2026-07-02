// Shared constants for the settings slice.

/**
 * Version tag recorded when a user accepts the legal docs. Bump this whenever
 * the Seller Agreement / Terms / Privacy copy materially changes — users who
 * accepted an older version are prompted to re-accept.
 *
 * NOTE: the current docs are placeholder drafts; real legal copy is pending.
 */
export const LEGAL_VERSION = "2026-07-draft.1";

/** Exact phrase a user must type to confirm account deletion. */
export const DELETE_CONFIRM_PHRASE = "delete my account";

/**
 * EU member states for the tax section (ISO 3166-1 alpha-2). Collected for
 * upcoming VAT/invoicing work — nothing downstream consumes these yet.
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
