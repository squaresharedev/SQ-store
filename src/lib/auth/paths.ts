/** Where the sign-in routes that other surfaces link to live, in one place.
 *  Pure strings, safe on the server and the client. */

/** Sign in, then carry on to `next` (an internal path). */
export function signInPath(next: string): string {
  return `/login?next=${encodeURIComponent(next)}`;
}

/** Settings › Security, where 2FA is managed and its activity is listed. */
export const SECURITY_SETTINGS_PATH = "/settings/security";

/** The password card on Settings › Account: where a "was this you?" alert points. */
export const PASSWORD_SETTINGS_PATH = "/settings/account#password";

/** The page a sign-in approval QR code opens on the phone. */
export function approveSignInPath(token: string): string {
  return `/approve/${encodeURIComponent(token)}`;
}
