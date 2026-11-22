import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { buildSampleStorefront } from "@/lib/storefront/sample";
import type { StorefrontTileProduct } from "@/types/storefront-page";
import { EditorTypeGallery } from "./EditorTypeGallery";
import { GALLERY_SECTIONS, type GallerySection } from "./fixtures";

// Living reference for the editor upgrade's TYPE, COLOR AND TEXT workstream:
// the five font pairings, the palette recolouring a whole board, saved text
// styles, vertical alignment, and a legacy board wearing none of it, each on
// a real board drawn by the buyer's own renderer (StorefrontBoard), plus the
// embed frame, the designer's tiles and the editor panels. No sign-in and no
// database. Dev-only: the route 404s in production builds.
//
// `?section=<pairings|color|text|legacy|panels|embed>` shows one section
// (pictures are taken a section at a time); no section shows them all.

export const metadata = { title: "Editor type: dev gallery" };

export default async function EditorTypeDevPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const query = await searchParams;
  const section = GALLERY_SECTIONS.find((name): name is GallerySection => name === query.section) ?? null;
  const sample = buildSampleStorefront(await getTranslations());
  const [first, second] = sample.products;
  // Two of the sample's photos, under Czech and Polish names.
  const tile = (product: typeof first, title: string): StorefrontTileProduct => ({
    id: product.id,
    title,
    price: product.price,
    currency: product.currency,
    imageUrl: product.imageUrl,
    href: "#",
  });
  const products = { a: tile(first, "Hrnek Šťovík"), b: tile(second, "Dzbanek Łąka") };
  const previewProducts = [
    { ...first, title: products.a.title },
    { ...second, title: products.b.title },
  ];

  return (
    <EditorTypeGallery section={section} products={products} previewProducts={previewProducts} seller={sample.seller} />
  );
}
