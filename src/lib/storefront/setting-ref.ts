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

import type { MessageKey } from "@/i18n/types";
import type { ProductPageSectionId } from "@/types/storefront";

/** The design panel's six groups, mirrored from ControlsPanel. */
export const CONTROLS_GROUPS = [
  "theme",
  "header",
  "typography",
  "cards",
  "soldOut",
  "productPage",
] as const;
export type ControlsGroup = (typeof CONTROLS_GROUPS)[number];

/** The two halves of the Product cards group. */
export type CardsSectionId = "cardStyle" | "priceTag";

/** The two halves of the Theme group: the published look, and the board
 *  itself (size, grid gap, and the seller-only grid guide). Merged into one
 *  top-of-menu entry because both are "how the whole storefront is shaped",
 *  and splitting them cost a seller a trip back to the top of the menu to
 *  get from one to the other. */
export type ThemeSectionId = "look" | "canvas";

/** The five sections of the Product page group. ("Panel" so it cannot be
 *  confused with the page's own on-screen sections, ProductPageSectionId.) */
export type ProductPagePanelSection = "layout" | "cta" | "sections" | "policies" | "seller";

export type SettingRef =
  /** A whole group of the design panel. */
  | { kind: "group"; group: ControlsGroup }
  /** A control that exists at BOTH scopes: the theme's copy under Product
   *  cards, and the selected tile's copy in its inspector. */
  | { kind: "cards"; section: CardsSectionId }
  /** One half of the Theme group: see ThemeSectionId. */
  | { kind: "theme"; section: ThemeSectionId }
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
 * ONE of these leaves the Product page group entirely, and that is the point:
 * the store's name bar really is a storefront-wide setting, so sending a
 * seller to the group that owns it beats opening a product-page section that
 * cannot change what they clicked. (The backdrop used to be the second such
 * case; see its entry below for why it no longer is.)
 */
export const PRODUCT_PAGE_HOTSPOTS = {
  /**
   * The page's backdrop. This USED to send a seller to the storefront's
   * Theme group, because the page had no backdrop of its own to change.
   * It has one now (`productPage.backgroundColor`), so a click on the page's
   * own background belongs to the control that owns it — including while that
   * control is set to follow the storefront, since "follow" is one of its
   * states rather than the absence of the setting.
   */
  background: { kind: "productPage", section: "layout" },
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
  if (ref.kind === "cards") return "cards";
  if (ref.kind === "theme") return "theme";
  return "productPage";
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
  if (a.kind === "theme" && b.kind === "theme") return a.section === b.section;
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
  /** Resolved through the reader's translator wherever it is shown or matched. */
  label: MessageKey;
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
export const GROUP_LABELS: Record<ControlsGroup, MessageKey> = {
  theme: "Storefront.settings.groups.theme",
  header: "Storefront.settings.groups.header",
  typography: "Storefront.settings.groups.typography",
  cards: "Storefront.settings.groups.cards",
  soldOut: "Storefront.settings.groups.soldOut",
  productPage: "Storefront.settings.groups.productPage",
};

/** The "Storefront / Theme" line, one whole message per group so a language
 *  can word the path however it needs to. */
export const GROUP_SUBTITLES: Record<ControlsGroup, MessageKey> = {
  theme: "Storefront.settings.subtitle.theme",
  header: "Storefront.settings.subtitle.header",
  typography: "Storefront.settings.subtitle.typography",
  cards: "Storefront.settings.subtitle.cards",
  soldOut: "Storefront.settings.subtitle.soldOut",
  productPage: "Storefront.settings.subtitle.productPage",
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
 *
 * Title and subtitle are in the reader's language; the keywords stay English
 * search vocabulary, matched in every language.
 */
export function settingIndexFields(
  setting: SettingEntry,
  t: (key: MessageKey) => string,
): {
  title: string;
  subtitle: string;
  keywords: readonly string[];
} {
  return {
    title: t(setting.label),
    subtitle: t(GROUP_SUBTITLES[settingGroup(setting.ref)]),
    keywords: setting.keywords,
  };
}

export const STOREFRONT_SETTINGS: readonly SettingEntry[] = [
  {
    id: "looks",
    label: "Storefront.settings.labels.looks",
    keywords: [
      "preset",
      "theme preset",
      "vibe",
      "style",
      "restyle",
      "minimal",
      "classic",
      "bold",
      "gallery",
      "appearance",
      "design",
      "template",
      "skin",
      "whole store look",
    ],
    ref: { kind: "theme", section: "look" },
  },
  {
    id: "background",
    label: "Storefront.settings.labels.background",
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
    ref: { kind: "theme", section: "look" },
  },
  {
    id: "accent",
    label: "Storefront.settings.labels.accent",
    keywords: [
      "brand colour",
      "primary colour",
      "highlight colour",
      "button colour",
      "link colour",
      "accent",
    ],
    ref: { kind: "theme", section: "look" },
  },
  {
    id: "header",
    label: "Storefront.settings.labels.header",
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
    label: "Storefront.settings.labels.font",
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
    label: "Storefront.settings.labels.canvasSize",
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
    ref: { kind: "theme", section: "canvas" },
  },
  {
    id: "grid-gap",
    label: "Storefront.settings.labels.gridGap",
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
    ref: { kind: "theme", section: "canvas" },
  },
  {
    id: "tile-layout",
    label: "Storefront.settings.labels.tileLayout",
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
    label: "Storefront.settings.labels.titlePosition",
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
    label: "Storefront.settings.labels.titleStyle",
    keywords: [
      "bar",
      "overlay",
      "shadow",
      "shadow colour",
      "fade colour",
      "gradient colour",
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
    label: "Storefront.settings.labels.cornerRadius",
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
    label: "Storefront.settings.labels.titleInset",
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
    label: "Storefront.settings.labels.pricePosition",
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
    label: "Storefront.settings.labels.priceStyle",
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
    label: "Storefront.settings.labels.soldOut",
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
    label: "Storefront.settings.labels.productPageLayout",
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
    id: "product-page-background",
    label: "Storefront.settings.labels.productPageBackground",
    keywords: [
      "page background",
      "page colour",
      "background colour",
      "backdrop",
      "white page",
      "dark page",
      "behind the product page",
      "different background on the page",
      "same as storefront background",
    ],
    ref: { kind: "productPage", section: "layout" },
  },
  {
    id: "product-page-photos",
    label: "Storefront.settings.labels.productPagePhotos",
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
    label: "Storefront.settings.labels.productPageFont",
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
    label: "Storefront.settings.labels.productPageIndexing",
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
    label: "Storefront.settings.labels.buyButton",
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
    id: "buy-button-colour",
    label: "Storefront.settings.labels.buyButtonColour",
    keywords: [
      "button colour",
      "buy button colour",
      "cta colour",
      "button fill",
      "make the button stand out",
      "button background",
      "checkout button colour",
    ],
    ref: { kind: "productPage", section: "cta" },
  },
  {
    id: "buy-button-roundness",
    label: "Storefront.settings.labels.buyButtonRoundness",
    keywords: [
      "rounded button",
      "button corners",
      "square button",
      "sharp button",
      "pill button",
      "button radius",
      "button shape",
    ],
    ref: { kind: "productPage", section: "cta" },
  },
  {
    id: "buy-button-border",
    label: "Storefront.settings.labels.buyButtonBorder",
    keywords: [
      "button border",
      "button outline",
      "border thickness",
      "border colour",
      "outlined button",
      "ghost button",
      "stroke around the button",
    ],
    ref: { kind: "productPage", section: "cta" },
  },
  {
    id: "price-note",
    label: "Storefront.settings.labels.priceNote",
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
    label: "Storefront.settings.labels.shippingNote",
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
    label: "Storefront.settings.labels.productPageSections",
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
    label: "Storefront.settings.labels.productPageAvailability",
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
    label: "Storefront.settings.labels.productPageByline",
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
    label: "Storefront.settings.labels.shippingReturns",
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
    label: "Storefront.settings.labels.sellerDetails",
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
