/**
 * THE SITE BUILDERS the embed settings say how to paste the snippet into, one
 * short instruction each (Storefront.embed.builders.<id>). "other" first: a
 * hand-written site, and the default.
 *
 * What a builder needs from the embed itself is not here: that is the frame
 * accepting a builder's own wrapper frame (isBuilderFrame in
 * lib/storefront/embed.ts) and the loader naming every page it sits in
 * (public/widget.js). This list is only the words for where the paste goes.
 *
 * Names are the builders' own and are not translated, so they live here
 * rather than in the message files; "other" is a phrase and is.
 */
export const EMBED_BUILDERS = [
  { id: "other" },
  { id: "wordpress", name: "WordPress" },
  { id: "squarespace", name: "Squarespace" },
  { id: "wix", name: "Wix" },
  { id: "webflow", name: "Webflow" },
  { id: "shopify", name: "Shopify" },
  { id: "google", name: "Google Sites" },
  { id: "framer", name: "Framer" },
  { id: "carrd", name: "Carrd" },
] as const;

export type EmbedBuilderId = (typeof EMBED_BUILDERS)[number]["id"];
