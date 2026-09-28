// CONTACT VERIFICATION POLICY: the numbers and names every part of the flow
// agrees on. Pure, so the settings UI (code length, cooldown copy) and the
// server (issuing, redeeming, budgets) read the same constants.
//
// WHAT IS BEING PROVEN. That the person holding THIS account can read the
// mailbox or the phone that buyers are shown. A code sent there and typed back
// into the signed-in session proves both halves at once; a clickable link
// proves neither (a mail scanner or the address's real owner can open it). See
// supabase/migrations/20260926_contact_verification.sql for the full story.

/** The buyer-facing contact details that are proven, as the DB names them. */
export const CONTACT_CHANNELS = ["email", "phone"] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export function isContactChannel(value: unknown): value is ContactChannel {
  return (
    typeof value === "string" && (CONTACT_CHANNELS as readonly string[]).includes(value)
  );
}

/**
 * Digits in a code. Eight rather than the usual six: every guess is bounded
 * (see {@link CONTACT_CODE_MAX_ATTEMPTS} and the per-target send budget), and
 * two more digits make the most an attacker can buy against one address a
 * hundred times smaller for the cost of two keystrokes.
 */
export const CONTACT_CODE_LENGTH = 8;

/** How long a code is good for. Long enough for a slow mail server. */
export const CONTACT_CODE_TTL_SECONDS = 15 * 60;

/**
 * Wrong guesses a single code survives. The fifth wrong one burns it, and the
 * next try needs a fresh code, which spends the send budgets.
 */
export const CONTACT_CODE_MAX_ATTEMPTS = 5;

/** Minimum gap between two codes for the same channel on one account. */
export const CONTACT_CODE_COOLDOWN_SECONDS = 60;

/**
 * Where SMS codes may be sent: the EU and EEA, Switzerland and the UK, which is
 * where this platform's sellers trade. It is the main defence against SMS
 * pumping (toll fraud: scripts that make a site text premium or high-cost
 * ranges and split the fee), so a number anywhere else is refused before any
 * text is paid for. Email has no equivalent cost, so it has no list.
 */
export const SMS_REGIONS: ReadonlySet<string> = new Set([
  // EU
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
  "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES",
  "SE",
  // EEA outside the EU, then Switzerland and the UK
  "IS", "LI", "NO", "CH", "GB",
]);
