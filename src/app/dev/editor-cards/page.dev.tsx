import { notFound } from "next/navigation";
import { EditorCardsGallery } from "./EditorCardsGallery";
import { GALLERY_SECTIONS, type GallerySection } from "./sections";

// Living reference for the editor upgrade's PHOTO CARDS (workstream 1): white
// studio photos on a coloured board, before and after the card's own colour
// and "Blend white background", the name strip, photo shapes, shadows on
// cards, images and shapes, and the two fixes (a `shadow` title over a white
// photo, and the readable floor on the tile labels). Every board is drawn by
// the buyer's renderer (StorefrontBoard, the hosted page's and the embed's),
// one by the designer's tiles (StorefrontPreview -> BlockTile), and the panels
// that set it all sit at the foot, driving a live board.
//
// The photos are the sample storefront's, on this origin, so the gallery
// measures their edges in the browser exactly as the designer does for the
// sample (lib/storefront/photo-edge), and hands each board its products with
// the answer, as a real store's products carry it.
//
// `?only=<section>[,<section>]` draws only those sections (see
// GALLERY_SECTIONS), for a focused picture. No sign-in, no database.
// Dev-only: the route 404s in production builds.

export const metadata = { title: "Photo cards: dev gallery" };

export default async function EditorCardsDevPage({
  searchParams,
}: {
  searchParams: Promise<{ only?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { only } = await searchParams;
  const wanted = (only ?? "")
    .split(",")
    .filter((id): id is GallerySection => (GALLERY_SECTIONS as readonly string[]).includes(id));
  return <EditorCardsGallery only={wanted.length > 0 ? wanted : null} />;
}
