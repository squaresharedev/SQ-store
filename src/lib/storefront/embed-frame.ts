// THE STOREFRONT EMBED'S FRAME: where it lives, and the rules for the site name
// its address carries. Pure and import-free, so the server, the frame's client
// code and the tests that hold next.config.ts and public/widget.js to these
// same values can all read it.
//
// HOW AN EMBED IS ALLOWED TO APPEAR, in one place, because the pieces sit in
// four files:
//
//   1. The loader (public/widget.js) frames `/e/<embed key>/<site>`, where
//      <site> is the host of the page it runs on.
//   2. next.config.ts answers that path with `frame-ancestors <site>`. A page
//      cannot set a response header on this stack and there is no middleware,
//      so the site rides in the PATH: path params are the one thing both
//      Next's own router and the OpenNext worker substitute into a header.
//      The browser then refuses to draw the frame anywhere but on <site>.
//   3. The frame's loader (lib/storefront/embed-frame-loader.ts) serves the
//      board only if <site> is on the storefront's allowlist.
//
// So the browser vouches that the real embedding site is the claimed one, and
// the server vouches that the claimed one is allowed. Neither half is enough
// alone: without (2) any site could claim an allowed name, without (3) any
// site could name itself.

/** Every embed frame lives under this prefix, and nothing else does. */
export const EMBED_FRAME_PREFIX = "/e/";

/**
 * The two path segments, as the patterns next.config.ts matches them with.
 * Deliberately narrow: whatever <site> matches is written into a response
 * header, so the class admits nothing that could end a directive or start
 * another (no space, semicolon, quote, slash or colon).
 */
export const EMBED_KEY_PATTERN = "[0-9a-f-]{36}";
export const EMBED_SITE_PATTERN = "[a-z0-9.-]+";
/**
 * Development only: a site may carry a port, because a test site on
 * localhost has one and `frame-ancestors` matches ports exactly. Never used in
 * a production build, where every embedding site is on https's own port.
 */
export const EMBED_SITE_PATTERN_DEV = "[a-z0-9.-]+(?::[0-9]{1,5})?";

/**
 * The policy the frame is served with. `:site` is the path segment above.
 *
 * KEEP THIS VALUE PLAIN. The OpenNext worker compiles it with path-to-regexp,
 * and on any character that library reads as syntax (another colon, `*`, `?`,
 * `+`, a bracket or brace) it gives up and sends the text as written, `:site`
 * included: every embed then goes blank in production while development still
 * works. tests/unit/embed-frame-headers.test.ts runs both.
 */
export const EMBED_FRAME_CSP = "frame-ancestors :site; base-uri 'none'; form-action 'none'; object-src 'none'";

/** A frame's address on the embed origin. */
export function embedFramePath(embedKey: string, site: string): string {
  return `${EMBED_FRAME_PREFIX}${embedKey}/${site}`;
}

/** Is this path an embed frame? The root layout's own scripts stay out of it. */
export function isEmbedFramePath(pathname: string): boolean {
  return pathname.startsWith(EMBED_FRAME_PREFIX);
}

/** `site` as the frame was asked for it, and the bare host to check. */
export type EmbedSite = { site: string; hostname: string };

const SITE_SHAPE = /^([a-z0-9.-]+)(?::([0-9]{1,5}))?$/;

/**
 * Read the <site> segment: a lowercase host, with a port only where one is
 * allowed. Null for anything else, which the route turns into a not-found.
 *
 * Stricter than the header pattern on purpose, never looser: a segment this
 * accepts must be one the header rule matched, or the board would be served
 * under a response that carries no `frame-ancestors` at all.
 */
export function parseEmbedSite(raw: string, options: { allowPort: boolean }): EmbedSite | null {
  const match = SITE_SHAPE.exec(raw);
  if (!match) return null;
  const [, hostname, port] = match;
  if (port !== undefined && !options.allowPort) return null;
  return { site: raw, hostname };
}

/** Marks a message as the frame's own; the loader reads nothing else. */
export const EMBED_MESSAGE_SOURCE = "squareshare-embed";

/** The tallest a frame may ask to be, in CSS pixels. A board is a few
 *  thousand at most; this only stops a broken measurement taking the page. */
export const EMBED_FRAME_MAX_HEIGHT = 20000;

/** How much of the storefront's name the frame's title may carry. */
export const EMBED_FRAME_TITLE_MAX = 120;

/** What the frame tells the page it sits in, and all it tells it. */
export type EmbedFrameMessage = {
  source: typeof EMBED_MESSAGE_SOURCE;
  height: number;
  title: string;
};
