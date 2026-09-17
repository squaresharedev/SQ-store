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
