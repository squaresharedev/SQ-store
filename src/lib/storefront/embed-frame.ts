// THE STOREFRONT EMBED'S FRAME: where it lives, and the rules for the site names
// its address carries. Pure and import-free, so the server, the frame's client
// code and the tests that hold next.config.ts and public/widget.js to these
// same values can all read it.
//
// HOW AN EMBED IS ALLOWED TO APPEAR, in one place, because the pieces sit in
// four files:
//
//   1. The loader (public/widget.js) frames `/e/<embed key>/<site>/<site>...`,
//      naming the page it runs on and every page that page sits inside. Most
//      sites are one page; a site builder that puts pasted code in a frame of
//      its own (Wix, Google Sites) adds its frame's host to the list.
//   2. next.config.ts answers that path with `frame-ancestors <site> <site>...`.
//      A page cannot set a response header on this stack and there is no
//      middleware, so the sites ride in the PATH: path params are the one thing
//      both Next's own router and the OpenNext worker substitute into a header.
//      The browser then refuses to draw the frame unless EVERY page above it is
//      one of the named sites.
//   3. The frame's loader (lib/storefront/embed-frame-loader.ts) serves the
//      board only if every named site is one the seller allows (see
//      areEmbedSitesAllowed in lib/storefront/embed.ts).
//
// So the browser vouches that the real pages above the frame are among the
// claimed ones, and the server vouches that the claimed ones are allowed.
// Neither half is enough alone: without (2) any site could claim an allowed
// name, without (3) any site could name itself.

/** Every embed frame lives under this prefix, and nothing else does. */
export const EMBED_FRAME_PREFIX = "/e/";

/**
 * How many sites one frame's address may name. One for an ordinary website,
 * two or three under a site builder's own frames; more is a page nested past
 * anything a builder does, and gets no header rule, so it is never drawn.
 * next.config.ts writes one rule per count up to this.
 */
export const EMBED_MAX_SITES = 4;

/**
 * The path segments, as the patterns next.config.ts matches them with.
 * Deliberately narrow: whatever a <site> matches is written into a response
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
 * The policy a frame is served with, for the sites its address named.
 * next.config.ts writes the same thing with `:s1 :s2 ...` in place of the
 * sites, which the router fills in from the path.
 *
 * KEEP THIS VALUE PLAIN. The OpenNext worker compiles it with path-to-regexp,
 * and on any character that library reads as syntax (another colon, `*`, `?`,
 * `+`, a bracket or brace) it gives up and sends the text as written, `:s1`
 * included: every embed then goes blank in production while development still
 * works. tests/unit/embed-frame-headers.test.ts runs both.
 *
 * HTTPS ONLY, WITHOUT WRITING "https://". The sites are bare hosts, and on a
 * frame served over https a bare host matches https pages only (CSP's
 * scheme-part rule: a scheme-less source keeps the frame's own scheme). So a
 * plain-http page is refused by the browser: checked 2026-10-21 in Chromium
 * 149 with an http and an https parent around one https frame. Writing the
 * scheme out is not an option on this stack: Next's router accepts
 * `https://:s1` but the worker's path-to-regexp throws on it and sends the
 * text as written, and `https\://:s1` is the reverse. public/widget.js also
 * refuses to make a frame under any plain-http page and says why.
 */
export function embedFramePolicy(sites: readonly string[]): string {
  return `frame-ancestors ${sites.join(" ")}; base-uri 'none'; form-action 'none'; object-src 'none'`;
}

/** A frame's address on the embed origin. */
export function embedFramePath(embedKey: string, sites: readonly string[]): string {
  return `${EMBED_FRAME_PREFIX}${embedKey}/${sites.join("/")}`;
}

/** Is this path an embed frame? The root layout's own scripts stay out of it. */
export function isEmbedFramePath(pathname: string): boolean {
  return pathname.startsWith(EMBED_FRAME_PREFIX);
}

/** `site` as the frame was asked for it, and the bare host to check. */
export type EmbedSite = { site: string; hostname: string };

/** The highest TCP port. */
const PORT_MAX = 65535;

const SITE_SHAPE = /^([a-z0-9.-]+)(?::([0-9]{1,5}))?$/;

/**
 * Read one <site> segment: a lowercase host, with a port only where one is
 * allowed. Null for anything else.
 *
 * Stricter than the header pattern on purpose, never looser: a segment this
 * accepts must be one the header rule matched, or the board would be served
 * under a response that carries no `frame-ancestors` at all.
 */
export function parseEmbedSite(raw: string, options: { allowPort: boolean }): EmbedSite | null {
  const match = SITE_SHAPE.exec(raw);
  if (!match) return null;
  const [, hostname, port] = match;
  if (port !== undefined && (!options.allowPort || Number(port) > PORT_MAX)) return null;
  return { site: raw, hostname };
}

/**
 * Read every <site> segment of a frame's address: one to EMBED_MAX_SITES of
 * them, each a site parseEmbedSite accepts. Null if any one is not, which the
 * route turns into a not-found: a frame is drawn for the whole list or not at
 * all, because the browser checks it as a whole.
 */
export function parseEmbedSites(raw: readonly string[], options: { allowPort: boolean }): EmbedSite[] | null {
  if (raw.length === 0 || raw.length > EMBED_MAX_SITES) return null;
  const sites: EmbedSite[] = [];
  for (const segment of raw) {
    const site = parseEmbedSite(segment, options);
    if (!site) return null;
    sites.push(site);
  }
  return sites;
}

/**
 * What the frame may do on a seller's page: run its own script, and open a
 * product's page in a new tab that is a normal tab. Nothing that acts on the
 * page around it (no top navigation, no dialogs, no downloads).
 *
 * `allow-forms` is for that new tab, not for the frame, which has no form and
 * is served `form-action 'none'`. Inside a site builder that sandboxes pasted
 * code itself (Wix does, without letting a popup escape), the product page
 * opens with what BOTH sandboxes allow, and without this its buy button could
 * not submit.
 *
 * The loader (public/widget.js) and the plain iframe snippet both use exactly
 * this; tests/unit/embed-widget.test.ts holds the loader to it.
 */
export const EMBED_FRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms";

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
