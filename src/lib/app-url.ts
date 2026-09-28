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

/** An app path (starting with "/") as an absolute URL. */
export function appUrl(path: string): string {
  return `${appOrigin()}${path}`;
}
