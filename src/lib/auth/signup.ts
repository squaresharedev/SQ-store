/**
 * The message a successful sign-up answers with ("check your email"). Named
 * here, client-safe, because the sign-in form recognises it: under it, it
 * offers a sign-in link instead for a confirmation email that never arrives.
 * lib/auth/actions.ts sends it.
 */
export const SIGNUP_CHECK_EMAIL_KEY = "Auth.success.signUpCheckEmail" as const;

/** The sign-in refusal for an account whose email was never confirmed. The
 *  form offers the same sign-in link under it: that link confirms it too. */
export const EMAIL_NOT_CONFIRMED_KEY = "Errors.auth.emailNotConfirmed" as const;
