/**
 * WHICH setting the editor should open, and the one list of settings there is.
 *
 * A DESCRIPTOR, deliberately, exactly like ColorTargetRef (lib/theme/
 * color-target.ts) and for the same reason: the thing asking (universal search,
 * or the panel's own filter field) sits on the far side of the tree from the
 * panel that has to open, and plain serializable data survives the trip through
 * a URL, a context, and a re-render that changed the selection underneath it.
 *
 * StorefrontDesigner owns the state and resolves a ref against the CURRENT
 * selection, so the same ref opens a tile's own control when a tile is selected
 * and the storefront-wide one when nothing is.
 */

import type { ProductPageSectionId } from "@/types/storefront";

/** The design panel's seven groups, mirrored from ControlsPanel. */
export const CONTROLS_GROUPS = [
  "theme",
  "header",
  "typography",
  "canvas",
  "cards",
  "soldOut",
  "productPage",
] as const;
export type ControlsGroup = (typeof CONTROLS_GROUPS)[number];

/** The two halves of the Product cards group. */
export type CardsSectionId = "cardStyle" | "priceTag";

/** The five sections of the Product page group. ("Panel" so it cannot be
 *  confused with the page's own on-screen sections, ProductPageSectionId.) */
export type ProductPagePanelSection = "layout" | "cta" | "sections" | "policies" | "seller";

export type SettingRef =
  /** A whole group of the design panel. */
  | { kind: "group"; group: ControlsGroup }
  /** A control that exists at BOTH scopes: the theme's copy under Product
   *  cards, and the selected tile's copy in its inspector. */
  | { kind: "cards"; section: CardsSectionId }
  /** One section of the Product page group. Opening any of these also turns
   *  the canvas to the product page, so the seller sees what they edit. */
  | { kind: "productPage"; section: ProductPagePanelSection };

/**
 * CLICKING THE PAGE ITSELF opens the setting behind what was clicked.
 *
 * The product page artboard is a picture of the thing being designed, so the
 * shortest path from "this is wrong" to the control that fixes it is to point
 * at it. Every region of the page carries `data-setting-hotspot` naming one of
 * these keys, and the artboard resolves the nearest one on click (see
 * ProductPageArtboard). The attribute is inert markup on the public page,
 * where nothing listens for it.
 *
 * Keys, not refs, in the markup: the page renders on the SERVER for buyers, so
 * what it writes has to be a plain string, and the mapping to a setting stays
 * here with the settings rather than being spelled out in the view.
 *
 * Two of these leave the Product page group entirely. That is the point: the
 * store's name bar and the page's background really are storefront-wide
 * settings, and sending a seller to the group that owns them beats opening a
 * product-page section that cannot change what they clicked.
 */
export const PRODUCT_PAGE_HOTSPOTS = {
  /** The page's backdrop, which is the storefront's own background. */
  background: { kind: "group", group: "theme" },
  /** The store's name bar across the top. */
  header: { kind: "group", group: "header" },
  /** Photos: gallery style, image fit, and which side they sit on. */
  layout: { kind: "productPage", section: "layout" },
  /** The button, its wording, and the notes printed with the price. */
  cta: { kind: "productPage", section: "cta" },
  /** What the page shows and in what order: title byline, description,
   *  availability, and the reference sections below. */
  sections: { kind: "productPage", section: "sections" },
  /** Shipping and returns text, wherever it surfaces. */
  policies: { kind: "productPage", section: "policies" },
  /** The trader identity block. */
  seller: { kind: "productPage", section: "seller" },
} as const satisfies Record<string, SettingRef>;

export type ProductPageHotspot = keyof typeof PRODUCT_PAGE_HOTSPOTS;

export function isProductPageHotspot(value: string): value is ProductPageHotspot {
  return Object.hasOwn(PRODUCT_PAGE_HOTSPOTS, value);
}

/**
 * Which hotspot each of the page's own collapsible sections answers to.
 *
 * Shipping and returns are the seller's POLICY TEXT, and the seller block is
 * the trader identity, so those three lead to the panels that hold the words
 * rather than to the list that only toggles them. The rest are shown or hidden
 * from the Sections panel, so that is where they lead.
 */
export const SECTION_SETTING: Record<ProductPageSectionId, ProductPageHotspot> = {
  description: "sections",
  specs: "sections",
  documents: "sections",
  shipping: "policies",
  returns: "policies",
  safety: "sections",
  seller: "seller",
};

/** Which group of the design panel a ref lands in. */
export function settingGroup(ref: SettingRef): ControlsGroup {
  if (ref.kind === "group") return ref.group;
  return ref.kind === "cards" ? "cards" : "productPage";
}

/** Field-by-field, because refs are minted fresh at every call site and `===`
 *  would never match. The mirror of isSameColorTarget. */
export function isSameSettingRef(
  a: SettingRef | null,
  b: SettingRef | null,
): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === "group" && b.kind === "group") return a.group === b.group;
  if (a.kind === "cards" && b.kind === "cards") return a.section === b.section;
  if (a.kind === "productPage" && b.kind === "productPage") {
    return a.section === b.section;
  }
  return false;
}

/** Whether a setting exists per tile as well as storefront-wide. Only a `cards`
 *  ref does; everything else is the storefront's and has no per-tile copy. */
export function isPerTileSetting(ref: SettingRef): boolean {
  return ref.kind === "cards";
}

/**
 * A copy of `ref`, safe to hand to `useState`'s setter.
 *
 * `isSameSettingRef` above exists because most refs ARE minted fresh at their
 * call site — but the hotspot table (PRODUCT_PAGE_HOTSPOTS) and the settings
 * catalogue (STOREFRONT_SETTINGS) are both module-level constants, so every
 * click on the same hotspot hands back the exact same object. Setting state
 * to a value it already holds by reference is a no-op React quietly bails
 * out of, which would swallow a seller's second click on the same hotspot if
 * they had navigated the panel elsewhere by hand in between — the request
 * would never reach the components that decide, BY VALUE via
 * isSameSettingRef, whether opening it again is already the current state.
 * Cloning keeps that decision where it belongs.
 */
export function freshSettingRef(ref: SettingRef): SettingRef {
  return { ...ref };
}

/**
 * One searchable setting. The SAME entries feed universal search and the
 * panel's own filter field, so a setting is added in exactly one place and can
 * never be findable in one and missing from the other.
 */
export type SettingEntry = {
  /** Stable id, and the value carried in `?setting=`. */
  id: string;
  label: string;
  /**
   * What else a seller might call it.
   *
   * The ranker handles spelling, typos and abbreviations on its own (see
   * lib/search/vocabulary), so there is no point listing "colour" next to
   * "color" or "bg" next to "background". What DOES belong here is the
   * vocabulary no rule could derive: the words for the thing that are not the
   * word we chose ("wallpaper", "gutter", "roundness"), and the way someone
   * describes it when they do not know its name at all ("behind the tiles",
   * "space between products").
   *
   * Matching is per word, so a multi-word keyword is not a phrase that has to
   * be typed whole. It contributes each of its words, and pays out in full
   * when the whole thing is typed.
   */
  keywords: readonly string[];
  ref: SettingRef;
};

/** Where each entry says it lives, for the second line of a search result. */
export const GROUP_LABELS: Record<ControlsGroup, string> = {
  theme: "Theme",
  header: "Header",
  typography: "Typography",
  canvas: "Canvas",
  cards: "Product cards",
  soldOut: "Sold out",
  productPage: "Product page",
};

/**
 * How a setting is DESCRIBED to any search index, in one place.
 *
 * This is the contract that keeps the two search surfaces honest. Both build
 * their own entry around this (they carry different payloads and render
 * differently), but the strings a query is matched against come from here, so
 * a setting cannot rank one way in the palette and another way in the editor.
 *
 * The subtitle says "Storefront" even inside the editor, where that is
 * obvious. It is deliberate: it is a searchable term as much as a caption, and
 * it is what lets "store bg colour" find the Background setting rather than
 * getting two words out of three. The editor shows the group name instead of
 * this line, which is a presentation choice and costs the matching nothing.
 */
export function settingIndexFields(setting: SettingEntry): {
  title: string;
  subtitle: string;
  keywords: readonly string[];
} {
  return {
    title: setting.label,
    subtitle: `Storefront / ${GROUP_LABELS[settingGroup(setting.ref)]}`,
    keywords: setting.keywords,
  };
}

export const STOREFRONT_SETTINGS: readonly SettingEntry[] = [
  {
    id: "looks",
    label: "Storefront look",
    keywords: [
      "preset",
      "theme preset",
      "vibe",
      "style",
      "restyle",
      "minimal",
      "bold",
      "luxe",
      "appearance",
      "design",
      "template",
      "skin",
      "whole store look",
    ],
    ref: { kind: "group", group: "theme" },
  },
  {
    id: "background",
    label: "Background",
    keywords: [
      "background colour",
      "store background colour",
      "storefront background",
      "canvas background",
      "page colour",
      "board colour",
      "gradient",
      "wallpaper",
      "backdrop",
      "background image",
      "behind the tiles",
      "behind the products",
    ],
    ref: { kind: "group", group: "theme" },
  },
  {
    id: "accent",
    label: "Accent colour",
    keywords: [
      "brand colour",
      "primary colour",
      "highlight colour",
      "button colour",
      "link colour",
      "accent",
    ],
    ref: { kind: "group", group: "theme" },
  },
  {
    id: "header",
    label: "Store name and bio",
    keywords: [
      "masthead",
      "heading",
      "store title",
      "storefront name",
      "shop name",
      "tagline",
      "about",
      "bio",
      "show header",
      "hide header",
      "intro text",
    ],
    ref: { kind: "group", group: "header" },
  },
  {
    id: "font",
    label: "Font",
    keywords: [
      "typeface",
      "typography",
      "custom font",
      "upload font",
      "lettering",
      "text style",
      "letters",
      "words look",
    ],
    ref: { kind: "group", group: "typography" },
  },
  {
    id: "canvas-size",
    label: "Canvas size",
    keywords: [
      "columns",
      "rows",
      "board size",
      "grid size",
      "bigger canvas",
      "wider",
      "taller",
      "more room",
      "resize the board",
      "how many products fit",
    ],
    ref: { kind: "group", group: "canvas" },
  },
  {
    id: "grid-gap",
    label: "Grid spacing",
    keywords: [
      "gap",
      "gutter",
      "density",
      "tile spacing",
      "space between tiles",
      "space between products",
      "tighter",
      "looser",
      "crowded",
    ],
    ref: { kind: "group", group: "canvas" },
  },
  {
    id: "tile-layout",
    label: "Tile layout",
    keywords: [
      "preset layout",
      "standard",
      "caption",
      "gallery",
      "bare",
      "arrangement",
      "card layout",
      "tile style",
      "product card",
    ],
    ref: { kind: "cards", section: "cardStyle" },
  },
  {
    id: "title-position",
    label: "Title position",
    keywords: [
      "move the title",
      "where is the title",
      "product name position",
      "title placement",
      "title spot",
      "name under the image",
      "hide the title",
    ],
    ref: { kind: "cards", section: "cardStyle" },
  },
  {
    id: "title-style",
    label: "Title style",
    keywords: [
      "bar",
      "overlay",
      "shadow",
      "caption style",
      "name style",
      "title colour",
      "product name colour",
      "title size",
    ],
    ref: { kind: "cards", section: "cardStyle" },
  },
  {
    id: "corner-radius",
    label: "Corner roundness",
    keywords: [
      "rounded corners",
      "circle tiles",
      "square tiles",
      "sharp corners",
      "radius",
      "card shape",
      "pill",
    ],
    ref: { kind: "cards", section: "cardStyle" },
  },
  {
    id: "title-inset",
    label: "Title edge spacing",
    keywords: [
      "padding",
      "breathing room",
      "inset",
      "title margin",
      "title padding",
      "text too close to the edge",
    ],
    ref: { kind: "cards", section: "cardStyle" },
  },
  {
    id: "price-position",
    label: "Price position",
    keywords: [
      "move the price",
      "where is the price",
      "price placement",
      "hide the price",
      "price spot",
      "show the price",
    ],
    ref: { kind: "cards", section: "priceTag" },
  },
  {
    id: "price-style",
    label: "Price tag style",
    keywords: [
      "price colour",
      "price tag colour",
      "price font",
      "price size",
      "chip",
      "price border",
    ],
    ref: { kind: "cards", section: "priceTag" },
  },
  {
    id: "sold-out",
    label: "Sold out products",
    keywords: [
      "out of stock",
      "hide sold out",
      "sold out badge",
      "unavailable",
      "stock",
      "inventory",
    ],
    ref: { kind: "group", group: "soldOut" },
  },
  // ---------------------------------------------------------------------
  // THE PRODUCT PAGE, at the same grain as everything above it.
  //
  // These used to be five entries, one per panel section, while the
  // storefront's own settings were listed control by control — so "roundness"
  // found its own row and "photo fit" found a row called "Product page
  // layout". A seller searching the page they are looking at deserves the same
  // answer as one searching the board, so every control that decides something
  // about the page has a row, and several rows lead to the same section
  // exactly as the four Card style entries already do.
  //
  // Inside the editor these are gated on a page actually being open (see
  // editor-search): a setting you cannot see the effect of is not worth
  // opening, so with no page out the whole group collapses to one row that
  // puts a page on the canvas first.
  // ---------------------------------------------------------------------
  {
    id: "product-page-layout",
    label: "Product page",
    keywords: [
      "product page",
      "detail page",
      "buy page",
      "product detail",
      "show a product page",
      "turn off product page",
      "hide product page",
      "page for each product",
      "what a tile opens",
    ],
    ref: { kind: "productPage", section: "layout" },
  },
  {
    id: "product-page-photos",
    label: "Product page photos",
    keywords: [
      "photo fit",
      "image fit",
      "fill",
      "crop the photo",
      "letterbox",
      "image left",
      "image right",
      "stacked gallery",
      "thumbnails",
      "photo layout",
      "picture size",
    ],
    ref: { kind: "productPage", section: "layout" },
  },
  {
    id: "product-page-font",
    label: "Product page font",
    keywords: [
      "page font",
      "page typeface",
      "different font on the page",
      "same as storefront",
      "inherit the font",
      "page lettering",
      "text colour",
    ],
    ref: { kind: "productPage", section: "layout" },
  },
  {
    id: "product-page-indexing",
    label: "Search engine listing",
    keywords: [
      "search engines",
      "google",
      "index",
      "indexing",
      "noindex",
      "seo",
      "keep it out of search",
      "findable on the web",
      "crawl",
    ],
    ref: { kind: "productPage", section: "layout" },
  },
  {
    id: "buy-button",
    label: "Buy button",
    keywords: [
      "cta",
      "call to action",
      "buy now",
      "button text",
      "button label",
      "checkout button",
      "purchase button",
      "order button",
      "what the button says",
    ],
    ref: { kind: "productPage", section: "cta" },
  },
  {
    id: "price-note",
    label: "Price note",
    keywords: [
      "incl vat",
      "excl vat",
      "tax note",
      "vat note",
      "including tax",
      "excluding tax",
      "under the price",
      "price caption",
    ],
    ref: { kind: "productPage", section: "cta" },
  },
  {
    id: "shipping-note",
    label: "Shipping note",
    keywords: [
      "plus shipping",
      "free shipping",
      "postage note",
      "delivery note",
      "shipping line",
      "next to the price",
    ],
    ref: { kind: "productPage", section: "cta" },
  },
  {
    id: "product-page-sections",
    label: "Product page sections",
    keywords: [
      "description",
      "specifications",
      "specs",
      "documents",
      "safety",
      "shipping section",
      "returns section",
      "hide description",
      "what the page shows",
      "show or hide sections",
      "page content",
    ],
    ref: { kind: "productPage", section: "sections" },
  },
  {
    id: "product-page-availability",
    label: "Availability on the page",
    keywords: [
      "show stock",
      "stock level",
      "how many left",
      "in stock",
      "quantity remaining",
      "availability",
    ],
    ref: { kind: "productPage", section: "sections" },
  },
  {
    id: "product-page-byline",
    label: "Sold by byline",
    keywords: [
      "sold by",
      "seller name",
      "byline",
      "who is selling this",
      "credit under the title",
      "maker name",
    ],
    ref: { kind: "productPage", section: "sections" },
  },
  {
    id: "shipping-returns",
    label: "Shipping and returns policy",
    keywords: [
      "shipping policy",
      "returns policy",
      "refund",
      "refunds",
      "delivery",
      "postage",
      "return window",
      "withdrawal",
      "legal text",
      "terms",
      // The profiles live in this panel, and "shipping profile" is the name
      // Shopify and Etsy taught sellers to search for.
      "shipping profile",
      "shipping profiles",
      "dispatch time",
      "processing time",
      "handling time",
      "ships within",
    ],
    ref: { kind: "productPage", section: "policies" },
  },
  {
    id: "seller-details",
    label: "Seller details",
    keywords: [
      "business name",
      "company name",
      "address",
      "vat id",
      "vat number",
      "tax id",
      "impressum",
      "imprint",
      "legal notice",
      "contact email",
      "phone",
      "country",
      "who is selling",
    ],
    ref: { kind: "productPage", section: "seller" },
  },
];

/**
 * The product page's own settings, in catalogue order.
 *
 * DERIVED rather than written out a second time: the editor treats these as
 * one gated block (they are only offered while a page is actually on the
 * canvas — see editor-search), and a hand-kept second list would quietly
 * ungate whichever entry someone forgot to add to it.
 */
export const PRODUCT_PAGE_SETTINGS: readonly SettingEntry[] =
  STOREFRONT_SETTINGS.filter((entry) => entry.ref.kind === "productPage");

/** Everything that is NOT the product page's: findable at all times. */
export const STOREFRONT_ONLY_SETTINGS: readonly SettingEntry[] =
  STOREFRONT_SETTINGS.filter((entry) => entry.ref.kind !== "productPage");

const BY_ID = new Map(STOREFRONT_SETTINGS.map((entry) => [entry.id, entry]));

export function settingById(id: string): SettingEntry | null {
  return BY_ID.get(id) ?? null;
}

/**
 * The link a search result carries.
 *
 * With a storefront id it goes straight to that editor; without one it goes to
 * the list, which is the honest answer for a seller who has not opened a
 * storefront yet. Either way the designer intercepts its OWN links before any
 * navigation happens (see StorefrontDesigner), so using a setting from inside
 * the editor never reloads the page.
 */
export function settingHref(id: string, storefrontId?: string): string {
  const base = storefrontId ? `/storefront/${storefrontId}` : "/storefront";
  return `${base}?setting=${encodeURIComponent(id)}`;
}

/** The `?setting=` id in a link, or null when it names no setting. */
export function settingIdFromHref(href: string): string | null {
  const query = href.indexOf("?");
  if (query === -1) return null;
  const id = new URLSearchParams(href.slice(query + 1)).get("setting");
  return id && BY_ID.has(id) ? id : null;
}
