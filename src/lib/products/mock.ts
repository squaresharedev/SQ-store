import type { Product } from "@/types/product";

// UI-only sample data for the visual/structural stage. A later stage replaces
// this module with real Supabase reads; the returned shape stays the same, so
// callers do not change. Image URLs are intentionally `null` so cards exercise
// the placeholder-tile path (no real assets exist yet).
export const MOCK_PRODUCTS: Product[] = [
  {
    id: "p_ambient-pack",
    title: "Ambient Loops Vol. 1",
    description:
      "Twelve royalty-free ambient loops for streams, videos, and games. WAV + MP3.",
    price: 14,
    currency: "EUR",
    status: "active",
    imageUrl: null,
    digitalFileName: "ambient-loops-vol-1.zip",
  },
  {
    id: "p_lightroom-presets",
    title: "Muted Film Presets",
    description: "A pack of 20 Lightroom presets with a soft, faded film look.",
    price: 9.5,
    currency: "EUR",
    status: "active",
    imageUrl: null,
    digitalFileName: "muted-film-presets.zip",
  },
  {
    id: "p_notion-template",
    title: "Freelance OS (Notion)",
    description:
      "A Notion workspace for freelancers: clients, invoices, and project tracking.",
    price: 19,
    currency: "USD",
    status: "draft",
    imageUrl: null,
    digitalFileName: null,
  },
  {
    id: "p_icon-set",
    title: "Line Icon Set",
    description: "240 consistent line icons as SVG and an icon font.",
    price: 24,
    currency: "EUR",
    status: "draft",
    imageUrl: null,
    digitalFileName: "line-icon-set.zip",
  },
];

/** Look up a single mock product by id (used to prefill the edit form). */
export function findMockProduct(id: string): Product | undefined {
  return MOCK_PRODUCTS.find((product) => product.id === id);
}
