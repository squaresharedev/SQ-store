/**
 * The app's own absolute URLs, for links that leave the browser: mail, the
 * embed payload, page metadata. Pure: safe on server and client.
 *
 * Built from NEXT_PUBLIC_APP_URL, never from a request's Host header, so a
 * forged Host cannot point a link in an email somewhere else.
 */

/** The configured origin, without a trailing slash. */
export function appOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

/**
 * The origin the storefront embed is served from (its loader script and its
 * frame), without a trailing slash. Null when there is none: the embed is then
 * not offered anywhere, which is how it ships before its hostname exists
 * (see LAUNCH SWITCHES in wrangler.jsonc).
 *
 * In development alone it falls back to the app's own origin, so the embed can
 * be worked on without a second host. Not "outside production": a test run
 * must see the same "not offered" state production starts in.
 */
export function embedOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_EMBED_URL;
  if (raw) return raw.replace(/\/+$/, "");
  return process.env.NODE_ENV === "development" ? appOrigin() : null;
}

/** An app path (starting with "/") as an absolute URL. */
export function appUrl(path: string): string {
  return `${appOrigin()}${path}`;
}
