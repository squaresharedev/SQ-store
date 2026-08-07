/**
 * ONE password strength rule, shared by every path that sets a new password:
 * sign-up, recovery reset, and the in-app change.
 *
 * Applying it in only one of those would be theatre. A signup gate that a user
 * can walk around by immediately "resetting" to `password1` has not raised the
 * floor, it has just moved the door, so all three call the same function.
 *
 * Pure and synchronous on purpose: no network, no dependency on a wordlist
 * service, so it runs identically in the browser (as a typing hint) and in the
 * server action (as the gate). Supabase's own HaveIBeenPwned check is the
 * complement to this, not a substitute, and vice versa: that one knows about
 * breaches, this one knows about the user's own email and handle.
 */

/** Bcrypt truncates past 72 BYTES; anything beyond is silently not checked. */
export const PASSWORD_MAX_LENGTH = 72;
export const PASSWORD_MIN_LENGTH = 8;

/**
 * Length at which a passphrase is accepted without a character-class mix.
 * "correct horse battery staple" is stronger than "P@ssw0rd" and must not be
 * the thing we reject, so length buys its way out of the mix requirement.
 */
const PASSPHRASE_LENGTH = 16;

/**
 * Passwords common enough that they are tried first in any real attack. Not a
 * breach corpus (that is Supabase's job, see above) — this is the short head of
 * the distribution, the ones worth refusing even offline, plus the ones this
 * product invites people to type (`squareshare`, `storefront`).
 */
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password12", "password123", "password1234",
  "passw0rd", "p@ssword", "p@ssw0rd", "passwordpassword",
  "12345678", "123456789", "1234567890", "123123123", "111111111",
  "qwertyui", "qwerty123", "qwertyuiop", "1qaz2wsx", "zaq12wsx",
  "iloveyou", "princess", "sunshine", "football", "baseball", "basketball",
  "superman", "batman123", "trustno1", "starwars", "pokemon123",
  "letmein1", "letmein123", "welcome1", "welcome123", "admin123",
  "administrator", "root1234", "changeme", "changeme123", "secret123",
  "monkey123", "dragon123", "master123", "shadow123", "michael1",
  "abc12345", "abcd1234", "a1b2c3d4", "asdfasdf", "asdfghjkl",
  "computer", "internet", "whatever", "freedom1", "ncc1701d",
  "squareshare", "squareshare1", "squareshare123", "storefront", "storefront1",
]);

/** Sequences that make a "mixed" password trivially guessable anyway. */
const SEQUENCES = [
  "abcdefgh", "12345678", "87654321", "qwertyui", "asdfghjk", "zxcvbnm",
];

function classCount(password: string): number {
  let classes = 0;
  if (/[a-z]/.test(password)) classes += 1;
  if (/[A-Z]/.test(password)) classes += 1;
  if (/[0-9]/.test(password)) classes += 1;
  if (/[^A-Za-z0-9]/.test(password)) classes += 1;
  return classes;
}

/** Strip the leet substitutions people reach for, so `P@ssw0rd` is recognised. */
function deleet(value: string): string {
  return value
    .toLowerCase()
    .replace(/[@4]/g, "a")
    .replace(/[3]/g, "e")
    .replace(/[1!|]/g, "i")
    .replace(/[0]/g, "o")
    .replace(/[$5]/g, "s")
    .replace(/[7]/g, "t");
}

/** Identity the password must not simply restate. */
export type PasswordContext = {
  email?: string;
  username?: string;
};

/**
 * The problem with this password, or null when it is acceptable.
 *
 * Returns a SINGLE message rather than a list: the form shows one line, and a
 * wall of every rule at once reads as a lecture. Ordered cheapest and most
 * actionable first.
 */
export function passwordProblem(
  password: string,
  context: PasswordContext = {},
): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  // Measured in BYTES, because that is what bcrypt truncates on: 72 emoji is
  // well past the limit even though it is 72 "characters".
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_LENGTH) {
    return `Keep it under ${PASSWORD_MAX_LENGTH} characters.`;
  }

  const lower = password.toLowerCase();
  const plain = deleet(password);

  if (COMMON_PASSWORDS.has(lower) || COMMON_PASSWORDS.has(plain)) {
    return "That password is too common. Pick something less guessable.";
  }

  // One repeated character, however long ("aaaaaaaaaa").
  if (/^(.)\1+$/.test(password)) {
    return "That password is too easy to guess. Try a longer mix of words.";
  }

  // Checked against BOTH forms. `plain` catches letter runs written with leet
  // substitutions, but de-leeting rewrites digits, so "12345678" only survives
  // in `lower` — check one and the digit runs walk straight through.
  if (SEQUENCES.some((seq) => lower.includes(seq) || plain.includes(seq))) {
    return "That password contains a common keyboard sequence. Try something else.";
  }

  // Restating your own identity gives an attacker who already knows your handle
  // (it is public) a first guess that works.
  const identities = [
    context.username,
    context.email?.split("@")[0],
  ].filter((value): value is string => Boolean(value) && value!.length >= 4);

  if (identities.some((value) => plain.includes(deleet(value)))) {
    return "Password must not contain your email address or username.";
  }

  if (password.length < PASSPHRASE_LENGTH && classCount(password) < 3) {
    return `Mix in upper and lower case, a number or a symbol — or use ${PASSPHRASE_LENGTH}+ characters.`;
  }

  return null;
}
