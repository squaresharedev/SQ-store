import { embedOrigin } from "@/lib/app-url";
import { escapeHtml } from "@/lib/format/html";
import { EMBED_FRAME_SANDBOX, EMBED_MAX_SITES, embedFramePath } from "@/lib/storefront/embed-frame";

/**
 * Whether the embed can be put on a website yet. ONE answer, like
 * STRIPE_CONNECT_AVAILABLE (lib/payments/availability.ts), for every surface
 * that would otherwise hand a seller a snippet that does nothing.
 *
 * The answer is "does the embed have a host": NEXT_PUBLIC_EMBED_URL (see
 * embedOrigin in lib/app-url.ts, and LAUNCH SWITCHES in wrangler.jsonc). The
 * code ships before that hostname exists, and a seller who copied a script tag
 * pointing at a host nothing serves would get an empty div on their site with
 * nothing to say why. So until there is one, the snippet is shown but cannot
 * be copied, whatever the settings say, and the page says the embed is still
 * on its way. The settings themselves save either way, so they are ready.
 */
export function isEmbedAvailable(): boolean {
  return embedOrigin() !== null;
}

/** The loader's file name on the embed origin (public/widget.js). */
export const EMBED_LOADER_PATH = "/widget.js";

/**
 * The host a snippet names while the embed has none of its own yet. Shown,
 * never copied (see isEmbedAvailable): it only keeps the picture of a snippet
 * honest about where the real one will point.
 */
const PLANNED_EMBED_ORIGIN = "https://embed.squareshare.eu";

/**
 * The snippet sellers paste into their own site.
 *
 * Keyed by the storefront's EMBED KEY, not its row id: this string ends up in
 * someone else's HTML permanently, so it has to be revocable. Rotating the key
 * invalidates every pasted copy without touching the storefront itself.
 *
 * The key is a server-issued uuid rendered as text, never user-controlled markup.
 *
 * Shared by the embed dialog and the guided tour's embed step, which shows a
 * sample so a seller with no storefront yet can still see what they will get.
 */
export function embedSnippet(embedKey: string): string {
  return [
    `<div data-squareshare-storefront="${embedKey}"></div>`,
    `<script async src="${embedOrigin() ?? PLANNED_EMBED_ORIGIN}${EMBED_LOADER_PATH}"></script>`,
  ].join("\n");
}

/**
 * How tall the plain-iframe snippet is, in CSS pixels. Without the loader
 * nothing can size the frame to its board, so it gets one fixed height that
 * shows a couple of rows and scrolls the rest; the seller can change it in the
 * code.
 */
export const EMBED_IFRAME_HEIGHT = 640;

/**
 * The sites a plain-iframe snippet names, from the seller's saved domains: each
 * domain as saved, then its www. twin, up to as many as one address may carry.
 * The loader works this out from the page it runs on; a pasted iframe cannot,
 * so it names the sites the seller listed. The domains come first, so a seller
 * with several still has each one named before any twin is.
 */
export function embedFrameSites(domains: readonly string[]): string[] {
  const twin = (domain: string) => (domain.startsWith("www.") ? domain.slice(4) : `www.${domain}`);
  const sites = [...domains, ...domains.map(twin)];
  return [...new Set(sites)].slice(0, EMBED_MAX_SITES);
}

/**
 * The snippet for a site that cannot run the loader: a site builder that strips
 * script tags, or one that loads its pages in a way that never runs them
 * (Squarespace's Ajax page loading). The same frame, sandboxed exactly as the
 * loader would, with a fixed height in place of the loader's fitted one.
 *
 * Frozen to the sites it names when copied: a domain added later needs a
 * fresh copy, and one removed stops it showing, which is the point.
 */
export function embedFrameSnippet(embedKey: string, sites: readonly string[]): string {
  const src = `${embedOrigin() ?? PLANNED_EMBED_ORIGIN}${embedFramePath(embedKey, sites)}`;
  return [
    `<iframe src="${escapeHtml(src)}" title="Shop" loading="lazy"`,
    `  sandbox="${EMBED_FRAME_SANDBOX}" referrerpolicy="no-referrer"`,
    `  style="display:block;width:100%;height:${EMBED_IFRAME_HEIGHT}px;border:0"></iframe>`,
  ].join("\n");
}

/**
 * The line a seller pastes into their own HTML for a buy button: a plain link
 * to the product's hosted page (built with `{ via: "button" }`), which they
 * style themselves. No script and no widget, so nothing of ours runs on their
 * site and there is nothing to revoke but the page itself.
 *
 * Both values are escaped although neither is seller text today (the URL is
 * our origin plus two UUIDs, the label a catalogue string): a snippet bound for
 * someone else's page is the last place a stray quote should break out.
 */
export function buyButtonSnippet(url: string, label: string): string {
  return `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
}

/**
 * The same job, as an instruction a seller hands to an AI coding agent that
 * works on their site: what to add, the exact URL, the snippet as a reference,
 * and the few rules an agent would otherwise get wrong (the page cannot be
 * framed, nothing needs a script, the URL must not be "tidied").
 *
 * NOTHING THE SELLER TYPED GOES IN HERE, on purpose. The sentences come from
 * the catalogue (in the seller's language) and the two values are machine made.
 * A product title would be text any team member with product access can edit,
 * arriving in a prompt that runs with write access to the owner's website.
 */
export function buyButtonPrompt(
  url: string,
  snippet: string,
  copy: { task: string; html: string; rules: readonly string[] },
): string {
  return [copy.task, url, "", copy.html, snippet, "", ...copy.rules.map((rule) => `- ${rule}`)].join("\n");
}
