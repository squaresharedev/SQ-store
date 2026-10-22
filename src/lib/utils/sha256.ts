/**
 * Lower-case hex SHA-256 of a UTF-8 string: the form Postgres produces with
 * encode(sha256(convert_to(text, 'UTF8')), 'hex'), so a hash taken here can be
 * matched by SQL. Web Crypto, so it runs on Workers and in the browser alike.
 */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
