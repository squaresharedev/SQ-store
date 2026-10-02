/**
 * A `mailto:` link to an order's buyer, for the moments a seller has to ask
 * something rather than do something: where a parcel should go, whether a
 * withdrawal is agreed, how a refund will reach them.
 *
 * The address came through the same validation as every buyer email (no control
 * characters, RFC length), but it is still spliced into a URL, so anything
 * outside the characters an address is made of is percent-encoded rather than
 * trusted. The subject is text a person will read, encoded whole.
 */
export function buyerMailto(email: string, subject: string): string {
  const address = email.replace(/[^A-Za-z0-9@.+_'-]/g, (char) => encodeURIComponent(char));
  return `mailto:${address}?subject=${encodeURIComponent(subject)}`;
}
