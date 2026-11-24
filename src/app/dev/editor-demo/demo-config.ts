import type { SampleStorefront } from "@/lib/storefront/sample";
import type { PhotoEdge } from "@/types/product";
import {
  DEFAULT_STOREFRONT_CONFIG,
  NEW_STOREFRONT_THEME,
  blockKey,
  type StorefrontBand,
  type StorefrontBlock,
  type StorefrontConfig,
  type StorefrontPalette,
} from "@/types/storefront";

// THE EDITOR UPGRADE'S DEMO STOREFRONT (/dev/editor-demo): ONE config that
// wears every feature the upgrade shipped, drawn by the real renderers. It is
// what a seller (or an assistant, through the MCP) can now build, and the
// checklist a reviewer reads the upgrade off. A unit test parses it with the
// storefront schema and checks that nothing shipped is missing from it
// (tests/unit/storefront/editor-demo.test.ts).
//
// It starts from what a NEW storefront is given (NEW_STOREFRONT_THEME), then
// sets the rest. Raw hex is allowed here: these are a gallery's fixtures, and
// every colour below is one of the palette's five.

const PALETTE: StorefrontPalette = {
  background: "#f4efe6",
  text: "#1f1a17",
  accent: "#b4532a",
  surface: "#fffaf2",
  muted: "#e6dccb",
};

/** Fixed ids, so pictures are stable between runs. */
const ID = {
  hero: "ed0de300-0000-4000-8000-000000000001",
  note: "ed0de300-0000-4000-8000-000000000002",
  photo: "ed0de300-0000-4000-8000-000000000003",
  heading: "ed0de300-0000-4000-8000-000000000011",
  lede: "ed0de300-0000-4000-8000-000000000012",
  shop: "ed0de300-0000-4000-8000-000000000013",
  portrait: "ed0de300-0000-4000-8000-000000000014",
  star: "ed0de300-0000-4000-8000-000000000015",
  strip: "ed0de300-0000-4000-8000-000000000016",
  label: "ed0de300-0000-4000-8000-000000000017",
  quote: "ed0de300-0000-4000-8000-000000000018",
  top: "ed0de300-0000-4000-8000-000000000019",
  story: "ed0de300-0000-4000-8000-00000000001a",
  carousel: "ed0de300-0000-4000-8000-00000000001b",
} as const;

/** Storage keys shaped as real ones are ({kind}/{owner}/{uuid}-{name}), so the
 *  schema accepts the demo as it would a saved storefront. Nothing is stored
 *  under them: the gallery hands the renderers pictures the app already serves. */
const KEY = {
  portrait: "elements/ed0de300-0000-4000-8000-0000000000aa/ed0de300-0000-4000-8000-0000000000b1-portrait.webp",
  bandPhoto: "images/ed0de300-0000-4000-8000-0000000000aa/ed0de300-0000-4000-8000-0000000000b2-succulent.webp",
  logo: "elements/ed0de300-0000-4000-8000-0000000000aa/ed0de300-0000-4000-8000-0000000000b3-logo.png",
} as const;

/** The photos the demo's image block, band and logo stand in for: pictures
 *  the app already serves, where a real storefront has signed URLs. */
export const DEMO_PORTRAIT = "/sample-storefront/speaker.webp";
export const DEMO_PORTRAIT_KEY = blockKey({
  type: "image",
  id: ID.portrait,
  key: KEY.portrait,
  alt: "",
  x: 0,
  y: 0,
  w: 1,
  h: 1,
});

export function editorDemoConfig(sample: SampleStorefront): StorefrontConfig {
  const [camera, headphones, watch, mouse, speaker] = sample.products.map((product) => product.id);

  // FULL-WIDTH BANDS: a palette gradient, a palette colour, and a photo under
  // a dark veil. Blocks sit on them; on a phone each follows its blocks.
  const bands: StorefrontBand[] = [
    { id: ID.hero, y: 0, h: 3, background: { kind: "gradient", from: PALETTE.surface, via: PALETTE.background, to: PALETTE.muted, angle: 135 } },
    { id: ID.note, y: 7, h: 1, background: { kind: "solid", color: PALETTE.text } },
    { id: ID.photo, y: 8, h: 3, background: { kind: "image", key: KEY.bandPhoto, x: 50, y: 50, scale: 100, dim: "dark" } },
  ];

  const blocks: StorefrontBlock[] = [
    // SAVED TEXT STYLES and VERTICAL ALIGNMENT: a Headline sitting at the foot
    // of its box, a Body line at the top of its own.
    { type: "text", id: ID.heading, text: "Things for slow mornings", variant: "heading", align: "left", valign: "bottom", x: 0, y: 0, w: 4, h: 2 },
    { type: "text", id: ID.lede, text: "Everyday objects, chosen to last.", variant: "body", align: "left", valign: "top", x: 0, y: 2, w: 3, h: 1 },
    // A BUTTON to a product on this board, wearing the storefront's button.
    { type: "button", id: ID.shop, label: "Shop the camera", link: { kind: "product", productId: camera }, x: 3, y: 2, w: 2, h: 1, fine: { bottom: true } },
    // An IMAGE BLOCK cut to a circle, lifted off the board.
    { type: "image", id: ID.portrait, key: KEY.portrait, alt: "A travel speaker", shape: "circle", shadow: "lifted", x: 4, y: 0, w: 2, h: 2 },
    // A SHAPE filled with a palette gradient, with a soft shadow, half a cell
    // across.
    { type: "shape", id: ID.star, kind: "star", color: PALETTE.accent, gradient: { from: PALETTE.accent, to: PALETTE.text, angle: 135 }, shadow: "soft", x: 5, y: 2, w: 1, h: 1, fine: { left: true, top: true } },
    // A SCROLLING TEXT STRIP, in the Small label style.
    { type: "marquee", id: ID.strip, text: "Free delivery this week · New pieces every Friday", speed: "slow", x: 0, y: 3, w: 6, h: 1 },
    // PHOTO CARDS. The theme blends white studio photos into the card colour
    // ("auto"): what each photo's edge measures is the PRODUCT's, handed to
    // the board with it (editorDemoPhotoEdges below).
    { type: "product", productId: camera, x: 0, y: 4, w: 2, h: 3 },
    { type: "product", productId: headphones, x: 2, y: 4, w: 2, h: 3 },
    // One card with its own look: an arch, lifted.
    { type: "product", productId: watch, x: 4, y: 4, w: 2, h: 3, style: { photoShape: "arch", shadow: "lifted" } },
    // A Small label on the dark band: its ink is picked to read there.
    { type: "text", id: ID.label, text: "Picked by hand · Packed with care", variant: "label", align: "center", x: 1, y: 7, w: 4, h: 1 },
    // On the photo band: words, and an outline button that scrolls to a band.
    { type: "text", id: ID.quote, text: "Made in small batches, never in a hurry.", variant: "heading", align: "center", valign: "middle", x: 1, y: 8, w: 4, h: 2, fine: { left: true, right: true } },
    { type: "button", id: ID.top, label: "Back to the top", link: { kind: "band", bandId: ID.hero }, look: "outline", x: 2, y: 10, w: 2, h: 1, fine: { bottom: true } },
    { type: "product", productId: mouse, x: 0, y: 11, w: 3, h: 2 },
    // A card with its own colour and the blend forced on.
    { type: "product", productId: speaker, x: 3, y: 11, w: 3, h: 2, style: { cardColor: PALETTE.muted, whiteBlend: "on", titleBarColor: PALETTE.text } },
    // A link button to an address of the seller's own.
    { type: "button", id: ID.story, label: "Read our story", link: { kind: "url", url: "https://example.com/story" }, look: "link", x: 1, y: 13, w: 4, h: 1, fine: { bottom: true } },
    // A PRODUCT CAROUSEL: every product in a row to swipe through, wearing
    // the theme's card look. Three show at a time on a desktop.
    { type: "carousel", id: ID.carousel, productIds: [speaker, watch, camera, headphones, mouse], x: 0, y: 14, w: 6, h: 2 },
  ];

  return {
    theme: {
      ...DEFAULT_STOREFRONT_CONFIG.theme,
      // What a new storefront starts with (palette, pairing, card colour,
      // blend, motion), then this storefront's own choices over it.
      ...NEW_STOREFRONT_THEME,
      rows: 16,
      cornerRadius: 14,
      // THE PALETTE: every colour on this board is one of these five.
      palette: PALETTE,
      accent: PALETTE.accent,
      // A THREE-STOP GRADIENT from the palette behind the board.
      background: { kind: "gradient", from: PALETTE.background, via: PALETTE.surface, to: PALETTE.muted, angle: 180 },
      // A FONT PAIRING: Fraunces headlines over Inter.
      fontPairing: "editorial",
      // SAVED TEXT STYLES, set once.
      textStyles: {
        heading: { size: 40, lineHeight: 110 },
        body: { size: 16, lineHeight: 150 },
        label: { uppercase: true, letterSpacing: 12, bold: true },
      },
      // THE CARD LOOK, for every card.
      cardColor: PALETTE.surface,
      whiteBlend: "auto",
      titleBarColor: PALETTE.surface,
      titleTextColor: PALETTE.text,
      titleFont: "heading",
      photoShape: "rounded",
      shadow: "soft",
      // MOTION and FINISH.
      motion: "lively",
      texture: "light",
    },
    // THE HEADER: a logo and a menu (a product, a band, an address).
    header: {
      show: true,
      name: "Parallel Goods",
      bio: "Objects for slow mornings.",
      logo: { key: KEY.logo, size: "small" },
      links: [
        { label: "Shop", link: { kind: "product", productId: camera } },
        { label: "How we work", link: { kind: "band", bandId: ID.photo } },
        { label: "Journal", link: { kind: "url", url: "https://example.com/journal" } },
      ],
    },
    blocks,
    bands,
  };
}

/**
 * What each sample photo's edge measures, as /dev/editor-cards measures it in
 * the browser: on a real storefront this is products.photo_edge, stored with
 * the product once the seller's browser has measured its photo, and handed to
 * a buyer's board with the product (lib/storefront/tile-extras). The camera,
 * the mouse and the speaker are not white at the edges, so "auto" leaves them
 * be (the speaker's card blends because it sets "on" for itself).
 */
export function editorDemoPhotoEdges(sample: SampleStorefront): Record<string, PhotoEdge> {
  const [camera, headphones, watch, mouse, speaker] = sample.products.map((product) => product.id);
  return { [camera]: "other", [headphones]: "white", [watch]: "white", [mouse]: "other", [speaker]: "other" };
}
