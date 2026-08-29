import {
  searchCatalog,
  type SearchEntry,
  type SearchSection,
  type SectionSpec,
} from "@/lib/search/catalog";
import {
  STOREFRONT_SETTINGS,
  settingIndexFields,
  type SettingRef,
} from "@/lib/storefront/setting-ref";
import type { Product } from "@/types/product";
import { blockKey, type StorefrontBlock } from "@/types/storefront";
import type { LibraryTab } from "./LibraryPanel";
import { BLOCK_KIND_LABELS, blockKeywords, blockLabel } from "./block-label";

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
const SECTIONS: SectionSpec[] = [
  { key: EDITOR_SECTIONS.canvas, label: "On the canvas" },
  { key: EDITOR_SECTIONS.settings, label: "Settings" },
  { key: EDITOR_SECTIONS.panels, label: "Panels" },
];

/** Settings never change, so this list is built once. */
const SETTING_ENTRIES: EditorSearchEntry[] = STOREFRONT_SETTINGS.map(
  (setting) => ({
    id: `setting:${setting.id}`,
    ...settingIndexFields(setting),
    section: EDITOR_SECTIONS.settings,
    payload: { kind: "setting", ref: setting.ref },
  }),
);

/**
 * The drawers. Titled as the thing you would go there TO DO rather than as
 * the panel's own name, because nobody searches for "the library".
 */
const PANEL_ENTRIES: EditorSearchEntry[] = [
  {
    id: "panel:layers",
    title: "Layers",
    subtitle: "Panel",
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
    title: "Add a product",
    subtitle: "Panel",
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
    title: "Shapes",
    subtitle: "Panel",
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
    title: "Uploads",
    subtitle: "Panel",
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
): EditorSearchEntry[] {
  return blocks.map((block) => {
    const key = blockKey(block);
    return {
      id: `block:${key}`,
      title: blockLabel(block, productsById),
      subtitle: BLOCK_KIND_LABELS[block.type],
      keywords: blockKeywords(block),
      section: EDITOR_SECTIONS.canvas,
      payload: { kind: "block", key },
    };
  });
}

/** The whole editor index. Settings and panels are constant; only the canvas
 *  half depends on the board. */
export function editorEntries(
  blocks: readonly StorefrontBlock[],
  productsById: ReadonlyMap<string, Product>,
): EditorSearchEntry[] {
  return [
    ...canvasEntries(blocks, productsById),
    ...SETTING_ENTRIES,
    ...PANEL_ENTRIES,
  ];
}

/** Eight rather than the palette's twelve: this list drops inside a 320px
 *  column above the menu it is filtering, and has to leave that menu visible. */
const EDITOR_LIMIT = 8;

export function searchEditor(
  entries: readonly EditorSearchEntry[],
  query: string,
  limit = EDITOR_LIMIT,
): EditorSearchSection[] {
  return searchCatalog(entries, query, { sections: SECTIONS, limit });
}
