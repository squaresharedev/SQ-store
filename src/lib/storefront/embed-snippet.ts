import { escapeHtml } from "@/lib/format/html";

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
    `<script async src="https://embed.squareshare.to/widget.js"></script>`,
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
