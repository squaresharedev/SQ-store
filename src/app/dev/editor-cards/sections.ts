/** The photo cards gallery's sections, by id, in the order they are drawn.
 *  Plain data (not in the client gallery) so the server page can read it. */
export const GALLERY_SECTIONS = [
  "measured",
  "legacy",
  "blend",
  "strip",
  "shapes",
  "shadows",
  "shadowFix",
  "labels",
  "freeform",
  "canvas",
  "panels",
] as const;
export type GallerySection = (typeof GALLERY_SECTIONS)[number];
