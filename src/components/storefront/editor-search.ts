import {
  searchCatalog,
  type SearchEntry,
  type SearchSection,
  type SectionSpec,
} from "@/lib/search/catalog";
import {
  GROUP_SUBTITLES,
  PRODUCT_PAGE_SETTINGS,
  STOREFRONT_ONLY_SETTINGS,
  settingIndexFields,
  type SettingEntry,
  type SettingRef,
} from "@/lib/storefront/setting-ref";
import type { Product } from "@/types/product";
import { blockKey, type StorefrontBlock } from "@/types/storefront";
import type { LibraryTab } from "./LibraryPanel";
import {
  BLOCK_KIND_LABELS,
  blockKeywords,
  blockLabel,
  type KeyTranslator,
} from "./block-label";

/**
 * WHAT THE EDITOR'S SEARCH FIELD CAN FIND.
 *
 * The universal palette answers "where in the app is that". Inside the editor
 * that question is already answered, and the one actually being asked is
 * narrower and more concrete: which control changes this, and where did that
 * object go. So this index is not a subset of the palette's, it is a different
 * index over the same machinery:
 *
 *   SETTINGS   every storefront setting, described by the same function the
 *              palette uses, so the two cannot rank one differently.
 *   CANVAS     every object on the board, by the name the layers list gives
 *              it. This is the half the palette could never have: it is built
 *              per render from live editor state, and "find the block I cannot
 *              click because something is on top of it" is the question the
 *              stack exists for.
 *   PANELS     the editor's own drawers, which are otherwise found only by
 *              recognising a toolbar icon.
 *
 * Everything ranks, groups and gates through lib/search/catalog. Adding a kind
 * of findable thing here is one more list and one more section.
 */

/** A drawer the editor can open. Mirrors what the toolbar already exposes. */
export type EditorPanel = "layers" | "products" | LibraryTab;

/** What picking a row asks the editor to do. Plain data, like SettingRef and
 *  for the same reason: it crosses a panel boundary and a re-render. */
export type EditorTarget =
  | { kind: "setting"; ref: SettingRef }
  | { kind: "block"; key: string }
  | { kind: "panel"; panel: EditorPanel };

/**
 * The targets the design panel cannot serve itself.
 *
 * It opens its own settings groups, so those never leave it; a block or a
 * drawer needs the editor that owns the board. Naming the subset rather than
 * passing the whole union up keeps that handler's switch exhaustive, so a new
 * kind of target is a compile error in the one place that has to grow.
 */
export type EditorJump = Exclude<EditorTarget, { kind: "setting" }>;

export type EditorSearchEntry = SearchEntry<EditorTarget>;
export type EditorSearchSection = SearchSection<EditorTarget>;

export const EDITOR_SECTIONS = {
  settings: "settings",
  canvas: "canvas",
  panels: "panels",
} as const;

/**
 * Canvas objects lead, and that is the interesting call.
 *
 * It only decides TIES: searchCatalog leads with whatever answered best, so a
 * query that clearly names a setting still puts the setting first. What this
 * order settles is the genuinely ambiguous case, where a seller has typed a
 * word that is both a setting and the name of something they placed. Their own
 * object is the more specific thing and the more likely target.
 */
function sections(t: KeyTranslator): SectionSpec[] {
  return [
    { key: EDITOR_SECTIONS.canvas, label: t("Storefront.editorSearch.sections.canvas") },
    { key: EDITOR_SECTIONS.settings, label: t("Storefront.editorSearch.sections.settings") },
    { key: EDITOR_SECTIONS.panels, label: t("Storefront.editorSearch.sections.panels") },
  ];
}

/** Settings never change, so these lists are built once per translator. */
function settingRows(
  settings: readonly SettingEntry[],
  t: KeyTranslator,
): EditorSearchEntry[] {
  return settings.map((setting) => ({
    id: `setting:${setting.id}`,
    ...settingIndexFields(setting, t),
    section: EDITOR_SECTIONS.settings,
    payload: { kind: "setting", ref: setting.ref },
  }));
}

/*
 * The storefront's own settings (SETTING_ENTRIES in the index below) are
 * findable whatever is on the canvas.
 */

/**
 * The product page's settings, offered ONLY while a page is on the canvas.
 *
 * Every one of these changes something a seller cannot see unless the page is
 * out — the button's wording, which sections show, how the photos are fitted.
 * Offering them against a board with no page would open a panel describing a
 * surface that is not on screen, which is how a seller ends up editing
 * confidently in the dark. So they are gated, and their absence is not silent:
 * see OPEN_PAGE_ENTRY below.
 */
/* PRODUCT_PAGE_ENTRIES in the index below. */

/**
 * WHAT STANDS IN FOR THEM while no page is open.
 *
 * Gating the rows must not make the product page unfindable — a seller typing
 * "buy button" with no page out has asked a perfectly good question, and
 * "nothing matches that" would be a lie. So the whole group collapses to one
 * row that answers it the only way that helps: it puts the page on the canvas.
 *
 * It carries the plain `layout` ref rather than a target of its own, because
 * the designer's opener ALREADY does exactly this (see openSetting: a
 * productPage ref with nothing out opens a page first). So this needs no new
 * handler anywhere, and in the dev gallery — where there is no designer to
 * open an artboard — it still does the honest lesser thing and opens the
 * group.
 *
 * Its vocabulary is the union of every gated row's, derived rather than
 * retyped: whatever words would have found a product page setting still find
 * the page itself, and a setting added above joins this row for free.
 *
 * EVERY LABEL COMES FIRST, ahead of the synonyms. The row shows the term it
 * recognised (see PanelSearchField), and that caption is the only thing
 * telling a seller their query was understood — so a search for "buy button"
 * has to answer "buy button" and not "buy page", which is a synonym of a
 * different row that happens to tie. Ties break on the earlier term, so the
 * names of the things go in front.
 */
function openPageEntry(t: KeyTranslator): EditorSearchEntry {
  return {
    id: "setting:open-product-page",
    title: t("Storefront.editorSearch.openProductPage"),
    // The same subtitle the gated rows carry, so a query naming the group
    // ("storefront product page") ranks this exactly as it ranked them.
    subtitle: t(GROUP_SUBTITLES.productPage),
    keywords: Array.from(
      new Set([
        ...PRODUCT_PAGE_SETTINGS.map((setting) => t(setting.label)),
        ...PRODUCT_PAGE_SETTINGS.flatMap((setting) => setting.keywords),
      ]),
    ),
    section: EDITOR_SECTIONS.settings,
    payload: { kind: "setting", ref: { kind: "productPage", section: "layout" } },
  };
}

/**
 * The drawers. Titled as the thing you would go there TO DO rather than as
 * the panel's own name, because nobody searches for "the library".
 */
function panelEntries(t: KeyTranslator): EditorSearchEntry[] {
  return [
    {
      id: "panel:layers",
      title: t("Storefront.editorSearch.panels.layers"),
      subtitle: t("Storefront.editorSearch.panelSubtitle"),
      keywords: [
        "stack",
        "order",
        "arrange",
        "z index",
        "bring to front",
        "send to back",
        "overlapping",
        "what is underneath",
        "hidden behind",
      ],
      section: EDITOR_SECTIONS.panels,
      payload: { kind: "panel", panel: "layers" },
    },
    {
      id: "panel:products",
      title: t("Storefront.editorSearch.panels.products"),
      subtitle: t("Storefront.editorSearch.panelSubtitle"),
      keywords: [
        "product picker",
        "place a product",
        "insert a product",
        "catalogue",
        "my items",
        "sell something here",
      ],
      section: EDITOR_SECTIONS.panels,
      payload: { kind: "panel", panel: "products" },
    },
    {
      id: "panel:shapes",
      title: t("Storefront.editorSearch.panels.shapes"),
      subtitle: t("Storefront.editorSearch.panelSubtitle"),
      keywords: [
        "add a shape",
        "circle",
        "square",
        "star",
        "line",
        "arrow",
        "divider",
        "decoration",
      ],
      section: EDITOR_SECTIONS.panels,
      payload: { kind: "panel", panel: "shapes" },
    },
    {
      id: "panel:uploads",
      title: t("Storefront.editorSearch.panels.uploads"),
      subtitle: t("Storefront.editorSearch.panelSubtitle"),
      keywords: [
        "my files",
        "add an image",
        "logo",
        "artwork",
        "graphic",
        "png",
        "svg",
        "element",
      ],
      section: EDITOR_SECTIONS.panels,
      payload: { kind: "panel", panel: "uploads" },
    },
  ];
}

/** Everything in the index that does not depend on the board, per translator
 *  (one per locale in practice), so the ranker's per-entry caches survive. */
type StaticRows = {
  sections: SectionSpec[];
  settings: EditorSearchEntry[];
  productPage: EditorSearchEntry[];
  openPage: EditorSearchEntry;
  panels: EditorSearchEntry[];
};

const STATIC_ROWS = new WeakMap<KeyTranslator, StaticRows>();

function staticRows(t: KeyTranslator): StaticRows {
  const cached = STATIC_ROWS.get(t);
  if (cached) return cached;
  const rows: StaticRows = {
    sections: sections(t),
    settings: settingRows(STOREFRONT_ONLY_SETTINGS, t),
    productPage: settingRows(PRODUCT_PAGE_SETTINGS, t),
    openPage: openPageEntry(t),
    panels: panelEntries(t),
  };
  STATIC_ROWS.set(t, rows);
  return rows;
}

/**
 * One entry per object on the board.
 *
 * Rebuilt whenever the board changes, which is why callers should memoise on
 * `blocks`. The cost is one small object per block; the matching itself caches
 * against the strings, not against these.
 */
function canvasEntries(
  blocks: readonly StorefrontBlock[],
  productsById: ReadonlyMap<string, Product>,
  t: KeyTranslator,
): EditorSearchEntry[] {
  return blocks.map((block) => {
    const key = blockKey(block);
    return {
      id: `block:${key}`,
      title: blockLabel(block, productsById, t),
      subtitle: t(BLOCK_KIND_LABELS[block.type]),
      keywords: blockKeywords(block),
      section: EDITOR_SECTIONS.canvas,
      payload: { kind: "block", key },
    };
  });
}

/**
 * The whole editor index.
 *
 * Panels are constant, the canvas half is the board, and the product page half
 * depends on WHAT IS OUT: with a page on the canvas its settings are listed
 * one by one like any other, and without one they collapse to the single row
 * that opens it. Defaulting `pageOpen` to false is the honest default for a
 * caller that does not track pages at all (the dev gallery, a test): it offers
 * the way in rather than settings for a surface nobody is looking at.
 */
export function editorEntries(
  blocks: readonly StorefrontBlock[],
  productsById: ReadonlyMap<string, Product>,
  t: KeyTranslator,
  options: { pageOpen?: boolean } = {},
): EditorSearchEntry[] {
  const rows = staticRows(t);
  return [
    ...canvasEntries(blocks, productsById, t),
    ...rows.settings,
    ...(options.pageOpen ? rows.productPage : [rows.openPage]),
    ...rows.panels,
  ];
}

/** Eight rather than the palette's twelve: this list drops inside a 320px
 *  column above the menu it is filtering, and has to leave that menu visible. */
const EDITOR_LIMIT = 8;

export function searchEditor(
  entries: readonly EditorSearchEntry[],
  query: string,
  t: KeyTranslator,
  limit = EDITOR_LIMIT,
): EditorSearchSection[] {
  return searchCatalog(entries, query, { sections: staticRows(t).sections, limit });
}
