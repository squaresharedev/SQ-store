// Shared site constants for the store dashboard. Kept in one place so a shared
// package can be extracted later.
//
// The session cookie's parent domain deliberately does NOT live here: it is a
// security-relevant value and belongs beside the options that spend it
// (lib/supabase/cookie-options.ts). The unused copy that used to sit here had
// already drifted to a different domain than the one actually in force, which
// is exactly the failure a second copy invites.

/** The marketplace / marketing site (waitlist + public pages). */
export const MARKETPLACE_URL = "https://squareshare.to";
