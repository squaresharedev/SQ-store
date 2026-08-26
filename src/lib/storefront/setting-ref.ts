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

/** The design panel's six groups, mirrored from ControlsPanel. */
export const CONTROLS_GROUPS = [
  "theme",
  "header",
  "typography",
  "canvas",
  "cards",
  "soldOut",
] as const;
export type ControlsGroup = (typeof CONTROLS_GROUPS)[number];

/** The two halves of the Product cards group. */
export type CardsSectionId = "cardStyle" | "priceTag";

export type SettingRef =
  /** A whole group of the design panel. */
  | { kind: "group"; group: ControlsGroup }
  /** A control that exists at BOTH scopes: the theme's copy under Product
   *  cards, and the selected tile's copy in its inspector. */
  | { kind: "cards"; section: CardsSectionId };

/** Which group of the design panel a ref lands in. */
export function settingGroup(ref: SettingRef): ControlsGroup {
  return ref.kind === "group" ? ref.group : "cards";
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
  return false;
}

/** Whether a setting exists per tile as well as storefront-wide. Only a `cards`
 *  ref does; everything else is the storefront's and has no per-tile copy. */
export function isPerTileSetting(ref: SettingRef): boolean {
  return ref.kind === "cards";
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
  /** What else a seller might call it. Ranked by the shared search ranker, so
   *  these only have to be plausible words, not an exhaustive thesaurus. */
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
};

export const STOREFRONT_SETTINGS: readonly SettingEntry[] = [
  {
    id: "looks",
    label: "Storefront look",
    keywords: ["preset", "theme preset", "vibe", "style", "restyle", "minimal", "bold", "luxe"],
    ref: { kind: "group", group: "theme" },
  },
  {
    id: "background",
    label: "Background",
    keywords: ["canvas background", "gradient", "wallpaper", "backdrop", "background image"],
    ref: { kind: "group", group: "theme" },
  },
  {
    id: "accent",
    label: "Accent colour",
    keywords: ["brand colour", "primary colour", "highlight", "accent color"],
    ref: { kind: "group", group: "theme" },
  },
  {
    id: "header",
    label: "Store name and bio",
    keywords: ["masthead", "heading", "store title", "tagline", "about", "show header"],
    ref: { kind: "group", group: "header" },
  },
  {
    id: "font",
    label: "Font",
    keywords: ["typeface", "typography", "custom font", "upload font", "lettering"],
    ref: { kind: "group", group: "typography" },
  },
  {
    id: "canvas-size",
    label: "Canvas size",
    keywords: ["columns", "rows", "board size", "grid size", "bigger canvas"],
    ref: { kind: "group", group: "canvas" },
  },
  {
    id: "grid-gap",
    label: "Grid spacing",
    keywords: ["gap", "gutter", "density", "tile spacing", "tighter", "looser"],
    ref: { kind: "group", group: "canvas" },
  },
  {
    id: "display-mode",
    label: "Grid or carousel",
    keywords: ["carousel", "slider", "layout mode", "scroll row"],
    ref: { kind: "group", group: "canvas" },
  },
  {
    id: "tile-layout",
    label: "Tile layout",
    keywords: ["preset layout", "standard", "caption", "gallery", "bare", "arrangement"],
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
    ],
    ref: { kind: "cards", section: "cardStyle" },
  },
  {
    id: "title-style",
    label: "Title style",
    keywords: ["bar", "overlay", "shadow", "caption style", "name style"],
    ref: { kind: "cards", section: "cardStyle" },
  },
  {
    id: "corner-radius",
    label: "Corner roundness",
    keywords: ["rounded corners", "circle tiles", "square tiles", "radius", "card shape"],
    ref: { kind: "cards", section: "cardStyle" },
  },
  {
    id: "title-inset",
    label: "Title edge spacing",
    keywords: ["padding", "breathing room", "inset", "title margin"],
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
    ],
    ref: { kind: "cards", section: "priceTag" },
  },
  {
    id: "price-style",
    label: "Price tag style",
    keywords: [
      "price colour",
      "price tag color",
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
    keywords: ["out of stock", "hide sold out", "sold out badge", "unavailable"],
    ref: { kind: "group", group: "soldOut" },
  },
];

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
