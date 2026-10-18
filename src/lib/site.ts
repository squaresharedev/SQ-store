// Shared site constants for the store dashboard. Kept in one place so a shared
// package can be extracted later.
//
// The session cookie's parent domain deliberately does NOT live here: it is a
// security-relevant value and belongs beside the options that spend it
// (lib/supabase/cookie-options.ts). The unused copy that used to sit here had
// already drifted to a different domain than the one actually in force, which
// is exactly the failure a second copy invites.

/**
 * Where anyone writes to reach Square Share: the Contact link on the error
 * pages, and the address a statement of reasons prints for an appeal
 * (lib/moderation/removal.ts). One mailbox, named once. app/global-error.tsx
 * carries its own copy on purpose (it must not import anything that could be
 * part of what failed), so change that one with this.
 */
export const SUPPORT_EMAIL = "support@squareshare.eu";
