"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { ArrowLeft, Search, X } from "lucide-react";
import type { Product } from "@/types/product";
import {
  CANVAS_COLUMNS_MAX,
  CANVAS_COLUMNS_MIN,
  CANVAS_ROWS_MAX,
  CANVAS_ROWS_MIN,
  EMPTY_STOREFRONT_HEADER,
  HEADER_BASE_PX,
  blockFootprint,
  blockKey,
  headerStyleValue,
  mergeCardStyleOverrides,
  readingOrder,
  setHeaderStyle,
  withRotation,
  type BlockPlacement,
  type CardStyleOverrides,
  type HeaderLine,
  type HeaderStyleField,
  type HeaderStyleValue,
  type ImageBlock,
  type ImagePlacement,
  type ShapeBlock,
  type ShapeKind,
  type StorefrontBlock,
  type StorefrontConfig,
  type StorefrontHeader,
  type StorefrontTheme,
  type TextBlock,
  type TextSpan,
  DEFAULT_PRODUCT_PAGE_CONFIG,
  type ProductPageConfig,
  type StorefrontSeller,
} from "@/types/storefront";
import { LAYER_OPS, moveLayerTo, type LayerOp } from "@/lib/storefront/layers";
import { isDefaultProductPage } from "@/lib/storefront/product-page";
import type { SellerShippingPolicy } from "@/types/shipping-policy";
import { applyFormatToRange } from "@/lib/storefront/text-spans";
import { isDefaultPlacement } from "@/lib/images/placement";
import { UploadError, uploadToR2 } from "@/lib/products/upload";
import {
  clampToCanvas,
  findFreeCell,
  packFirstFit,
  placementIsFree,
} from "@/components/grid/gridConstants";
import { MAX_BLOCKS, STOREFRONT_NAME_MAX } from "@/lib/validation/storefront";
import { saveStorefront } from "@/lib/storefront/actions";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  helpTextClass,
  iconButtonClass,
  iconNudgeLeftClass,
} from "@/components/ui/control-styles";
import { ColorTargetProvider } from "@/lib/theme/color-context";
import {
  PRICE_TAG_COLOR_KEYS,
  colorTargetKey,
  primaryColorTarget,
  resolveColorTarget,
  type ColorTargetRef,
} from "@/lib/theme/color-target";
import { collectStorefrontColors } from "@/lib/theme/palette";
import { ColorPanel, type PanelTypography } from "./ColorPanel";
import type {
  InlineFormatKey,
  TextEditSource,
  TextRange,
} from "./InlineTextEditor";
import { LibraryPanel, type LibraryTab } from "./LibraryPanel";
import { SettingTargetProvider } from "@/lib/storefront/setting-context";
import {
  freshSettingRef,
  isPerTileSetting,
  settingById,
  settingIdFromHref,
  type SettingRef,
} from "@/lib/storefront/setting-ref";
import type { SpotDrop, SpotToken } from "./TileSpotDragLayer";
import type { StorefrontUpload } from "./UploadsPanel";

/**
 * What the left-hand docked panel is showing. Colors name a specific field
 * (and close themselves when it stops existing); the library names nothing and
 * simply stays until dismissed.
 */
type LeftPanelState =
  | { kind: "color"; ref: ColorTargetRef }
  | { kind: "library"; tab: LibraryTab }
  | null;
import { editorEntries, type EditorJump } from "./editor-search";
import { ControlsPanel } from "./ControlsPanel";
import { DesignPanel } from "./DesignPanel";
import { SHEET_ON_MOBILE_CLASS, activeMobileSheet } from "./panel-chrome";
import { useEditorSurface } from "./useEditorSurface";
import { DesignerCanvas } from "./DesignerCanvas";
import { EditorToolbar } from "./EditorToolbar";
import { SelectionToolbar } from "./SelectionToolbar";
import {
  SUMMON_FLASH_CLASS,
  SUMMON_LIT_CLASS,
  useSummonFlash,
  type BlockField,
  type BlockFieldSummons,
} from "./SummonedField";
import { ImageBlockEditor } from "./ImageBlockEditor";
import { MultiBlockEditor } from "./MultiBlockEditor";
import { PlacementSection } from "./PlacementSection";
import { LayersPanel } from "./LayersPanel";
import { ProductPicker } from "./ProductPicker";
import { ProductBlockEditor } from "./ProductBlockEditor";
import { ShapeBlockEditor, type ShapeBlockPatch } from "./ShapeBlockEditor";
import { TextBlockEditor, type TextBlockPatch } from "./TextBlockEditor";
import { useCanvasViewport } from "./useCanvasViewport";
import { CANVAS_PANEL_ATTR, useCanvasAnchor } from "./useCanvasAnchor";
import { safeSpan } from "./canvas-geometry";
import { useEditorHistory } from "./useEditorHistory";
import { useUnsavedChangesGuard } from "@/lib/hooks/useUnsavedChangesGuard";
import { SearchProvider, useSearch } from "@/components/search/SearchProvider";
import type { TeamRole } from "@/lib/team/permissions";

/** What the left inspector column shows: the product picker, or the editor
 *  card for the selected block(s). One key = that block's own editor; several
 *  = the group editor (MultiBlockEditor), applying changes to all of them. */
type InspectorState = { kind: "picker" } | { kind: "blocks"; keys: string[] };

/** The undoable slice of editor state (name is excluded — the top-bar input
 *  has its own native undo and per-keystroke history would drown edits). */
type EditorSnapshot = {
  theme: StorefrontTheme;
  header: StorefrontHeader;
  blocks: StorefrontBlock[];
  productPage: ProductPageConfig;
  // NO `policies` OR `shippingProfiles` HERE either, for the same reason as
  // `seller`: shipping and returns terms are account-level and read-only in
  // this editor, so there is nothing about them to undo.
  // NO `seller` HERE. Trader identity is account-level and read-only in this
  // editor (see the `sellerIdentity` prop below) — it has no undo history of
  // its own because there is nothing here to undo.
};

/** First shallowly-changed field, used as the history coalesce key so rapid
 *  same-field edits (color drags, slider scrubs) undo as one step. */
function changedField<T extends object>(prev: T, next: T): string {
  for (const key of Object.keys(next) as (keyof T)[]) {
    if (prev[key] !== next[key]) return String(key);
  }
  return "unchanged";
}

/** Canvas zoom bounds. A view preference only: never saved, never seen by
 *  buyers, and deliberately NOT affecting layout width, so zooming out never
 *  trips the grid's small-screen reflow. */
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;

function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value * 100) / 100));
}

/** Breathing room left around the board when it is centred or fitted. */
const CANVAS_MARGIN = 24;

/** Rough line height / page size used to convert non-pixel wheel deltas. */
const WHEEL_LINE_PX = 16;

/**
 * Wheel deltas in PIXELS, whatever the device reported. Firefox sends whole
 * lines for a mouse wheel (deltaY: ±1, deltaMode 1) while Chrome and Safari
 * send pixels, so treating every delta as pixels made a mouse wheel crawl one
 * pixel per notch there.
 */
function normalizeWheel(event: WheelEvent): { x: number; y: number } {
  const scale =
    event.deltaMode === 1
      ? WHEEL_LINE_PX
      : event.deltaMode === 2
        ? window.innerHeight
        : 1;
  return { x: event.deltaX * scale, y: event.deltaY * scale };
}

/**
 * Keep the workspace point under (anchorX, anchorY) pinned while the zoom
 * changes, so zooming happens about the cursor instead of the corner. The
 * board point under the anchor is `(anchor - pan) / zoom`; solving for the
 * pan that keeps it there at the new zoom gives this.
 */
function panAfterZoom(
  pan: { x: number; y: number },
  from: number,
  to: number,
  anchorX: number,
  anchorY: number,
): { x: number; y: number } {
  return {
    x: anchorX - ((anchorX - pan.x) / from) * to,
    y: anchorY - ((anchorY - pan.y) / from) * to,
  };
}

/** Design panel width bounds, in px (desktop only). Dragging the edge below
 *  the minimum collapses the panel rather than squeezing it unusably narrow. */
const PANEL_MIN_WIDTH = 260;
const PANEL_MAX_WIDTH = 560;
const PANEL_DEFAULT_WIDTH = 320;
/** How far one arrow-key press nudges the panel edge. */
const PANEL_RESIZE_STEP = 16;

/**
 * WHETHER THE SMALL-SCREEN EDITING NOTICE HAS BEEN WAVED AWAY, as a tiny
 * external store rather than component state.
 *
 * The answer lives in localStorage, which the server does not have, so it
 * cannot simply seed `useState`: the markup would differ between the two
 * renders. `useSyncExternalStore` is the shape React provides for exactly this:
 * the server (and the hydrating client) get `false`, and the real answer
 * arrives on the first render after hydration, with no effect and no setState
 * chasing it.
 *
 * The cached snapshot is not an optimisation but a requirement: getSnapshot is
 * called on every render and must return the SAME value until something has
 * actually changed, so reading localStorage afresh each time would be a new
 * answer to compare on every pass.
 */
const MOBILE_NOTICE_KEY = "sq.storefront.mobile-notice-dismissed";
const noticeListeners = new Set<() => void>();
let noticeSnapshot: boolean | null = null;

function subscribeNotice(onChange: () => void) {
  noticeListeners.add(onChange);
  return () => {
    noticeListeners.delete(onChange);
  };
}

function noticeIsDismissed(): boolean {
  if (noticeSnapshot === null) {
    try {
      noticeSnapshot = localStorage.getItem(MOBILE_NOTICE_KEY) === "1";
    } catch {
      // Private mode / storage disabled: the notice simply keeps showing.
      noticeSnapshot = false;
    }
  }
  return noticeSnapshot;
}

function dismissMobileNotice() {
  noticeSnapshot = true;
  try {
    localStorage.setItem(MOBILE_NOTICE_KEY, "1");
  } catch {
    // Dismissed for this visit either way; only the memory is lost.
  }
  for (const listener of noticeListeners) listener();
}

/**
 * Page-level composition + state owner for the storefront designer. Content is
 * inserted from the bottom toolbar. The RIGHT panel holds the selected block's
 * editor card stacked over the global design settings; the LEFT panel is the
 * color chooser, present only while a color is being edited and aimed by any
 * color field via ColorTargetProvider.
 * Blocks are kept in array order; `order` integers are assigned on save.
 * Client-side constraints are UX only — the save action re-validates with Zod
 * and re-checks product ownership server-side.
 */
export function StorefrontDesigner({
  storefrontId,
  initialName,
  initialConfig,
  products,
  initialBackgroundImageUrl = null,
  initialCustomFontUrl = null,
  initialElementUrls = {},
  initialSetting = null,
  role = null,
  accountId = null,
  sellerIdentity = {},
  shippingPolicy = {},
}: {
  storefrontId: string;
  initialName: string;
  initialConfig: StorefrontConfig;
  products: Product[];
  /** The active account's trader identity (Settings › Business & seller
   *  details), read-only here — see lib/settings/seller-identity.ts. Shown on
   *  every product page of this storefront; this editor has no control that
   *  edits it, only a link to where it is. */
  sellerIdentity?: StorefrontSeller;
  /** The active account's shipping and returns terms (Settings › Shipping &
   *  returns), read-only here — see lib/settings/shipping-policy.ts. Every
   *  product page of this storefront sells under them; this editor has no
   *  control that edits them, only a link to where it is. */
  shippingPolicy?: SellerShippingPolicy;
  /** Signed display URL for a stored image background (null when none). */
  initialBackgroundImageUrl?: string | null;
  /** Signed display URL for a stored uploaded font (null when none). */
  initialCustomFontUrl?: string | null;
  /** Signed display URL per image block, keyed by blockKey. Blocks whose
   *  signing failed are simply absent and render their placeholder. */
  initialElementUrls?: Record<string, string>;
  /** A setting named in the URL, from a search result picked outside the
   *  editor. Opened once on arrival and never read again. */
  initialSetting?: string | null;
  /** Active account role, for universal search's action gating. */
  role?: TeamRole | null;
  /** Active account id, for universal search's snapshot cache. */
  accountId?: string | null;
}) {
  const toast = useToast();
  const [name, setName] = useState(initialName);
  // Display URL for the image background: server-signed at load; replaced by
  // a local object URL right after an in-session upload. NOT part of the
  // config (the config stores only the object key).
  const [backgroundImageUrl, setBackgroundImageUrl] = useState(
    initialBackgroundImageUrl,
  );
  // Same arrangement for the uploaded typeface: server-signed at load, a local
  // object URL right after an upload, and never part of the config (which
  // stores only the object key).
  const [customFontUrl, setCustomFontUrl] = useState(initialCustomFontUrl);
  // Display URL per image block, keyed by blockKey. Seeded with the signed
  // URLs the server resolved at page load, then extended with a local object
  // URL for each element added in this session (signing is server-side, so a
  // block created here has no signed URL until the page is loaded again).
  const [elementUrls, setElementUrls] = useState<Record<string, string>>(
    initialElementUrls,
  );
  // True while an element upload is in flight, so the toolbar and the library
  // panel can say so rather than looking inert on a slow connection.
  const [uploadingElement, setUploadingElement] = useState(false);
  // 0..1 while the bytes move, then null while the server sniffs, moderates
  // and stores them — which is real work, and a bar parked at 100% looks hung.
  const [uploadProgress, setUploadProgress] = useState<number | null>(0);
  // Catalog snapshot, updated in place after inline product edits. Product
  // facts (name/price) are saved to the DB immediately by the block editor;
  // they are NOT part of the storefront config, so they bypass the dirty flag
  // and undo history; this state only keeps the canvas tiles in sync.
  const [catalog, setCatalog] = useState(products);
  const [theme, setTheme] = useState<StorefrontTheme>(initialConfig.theme);
  const [header, setHeader] = useState<StorefrontHeader>(
    // EMPTY, not DEFAULT: a config with no header member predates the feature,
    // and opening it must not put placeholder text over the storefront.
    initialConfig.header ?? EMPTY_STOREFRONT_HEADER,
  );
  // Placement is explicit, so the array is just a bag of blocks.
  const [blocks, setBlocks] = useState<StorefrontBlock[]>(initialConfig.blocks);
  // The product page's own options: an ordinary config member, so it rides
  // ride the same undo history and the same save.
  const [productPage, setProductPage] = useState<ProductPageConfig>(
    initialConfig.productPage ?? DEFAULT_PRODUCT_PAGE_CONFIG,
  );
  // WHICH PRODUCT PAGES ARE OUT, in the order they were opened. Each one is an
  // artboard on the canvas beside the board, joined to its tile by a line. A
  // VIEW state: which pages the seller has open is not part of the design, so
  // it is never saved and never enters the undo history.
  const [openPages, setOpenPages] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  // Unsaved-edits flag. The header shows exactly one thing — whether there is
  // work not yet written — while the OUTCOME of a save (done / dropped blocks
  // / failed) is a toast, so it reaches the eye even in the full-screen editor
  // where the Save button is a long way from the canvas being edited.
  const [dirty, setDirty] = useState(false);
  const [inspector, setInspector] = useState<InspectorState | null>(null);
  // Mobile only: whether the global-settings bottom sheet is open (on lg+ the
  // settings panel is always visible, so this is ignored there).
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Whether the design panel is showing the whole stack instead of its usual
  // two scopes. A view state, so it never reaches undo or the saved document —
  // and deliberately NOT cleared when the selection changes: picking blocks off
  // the list is the point of having it open.
  const [layersOpen, setLayersOpen] = useState(false);
  // Desktop only: whether the edge-docked design panel is shown. Collapsing
  // it gives the canvas the full viewport width.
  const [panelOpen, setPanelOpen] = useState(true);
  /** Which control of the selected block's inspector the toolbar last asked
   *  for, if any. Handed to the block editors, which scroll to it and mark it. */
  const [blockField, setBlockField] = useState<BlockFieldSummons>(null);
  const blockFieldNonce = useRef(1);
  /**
   * The colour panel's own summons, minted when the toolbar's colour button
   * opens it. The whole panel is the answer there — it has no one field to
   * point at — so the whole panel is what lights up.
   *
   * Only from the TOOLBAR. Selecting a shape opens this panel by itself, and a
   * panel that flashed every time a block was clicked would be a tic rather
   * than an answer.
   */
  const [colorSummons, setColorSummons] = useState<number | null>(null);
  const colorSummonsNonce = useRef(1);
  // Whether the "open this on a desktop" notice has been waved away. On a phone
  // the editor has roughly 300px of workspace to begin with and this banner
  // spends two lines of it, so a seller who has read it once and has no desktop
  // to move to needs to be able to take it back. Remembered per browser rather
  // than per visit for the same reason: an advisory that returns on every load
  // is not advice, it is a toll. See the store above it for why it is not state.
  const noticeDismissed = useSyncExternalStore(
    subscribeNotice,
    noticeIsDismissed,
    () => false,
  );
  // Where the panels are columns beside the canvas ("regular") and where they
  // are sheets stacked over it ("compact"). Only BEHAVIOUR reads this; layout
  // stays on `lg:` classes. See useEditorSurface.
  const surface = useEditorSurface();
  // Dashed empty-slot guides on the canvas. A VIEW preference: buyers never
  // see them, so it stays out of the saved config (and out of undo history).
  const [showGrid, setShowGrid] = useState(true);
  // Desktop panel width, dragged from its left edge. Kept at or above the
  // minimum: a drag that would go narrower closes the panel instead, so
  // reopening never lands on an unusably thin strip.
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT_WIDTH);
  // WHAT THE LEFT PANEL IS SHOWING, or null when it is closed. It began as
  // colors only; the shape library moved in when it outgrew the toolbar's
  // hover strip, so the slot is now a small union rather than one ref.
  //
  // The color mode still stores a plain DESCRIPTOR rather than a value+setter
  // pair, so deleting the block it names, undoing, or switching the background
  // to an image simply makes it resolve to null instead of stranding the panel
  // on something that no longer exists. The shapes mode names nothing, so it
  // stays open until it is dismissed.
  const [leftPanel, setLeftPanel] = useState<LeftPanelState>(null);

  // The color slice, read and written exactly as it was before the union
  // existed — which is what keeps every call site below unchanged. Clearing
  // it closes the panel ONLY if colors are what it is currently showing, so
  // deselecting a block cannot yank the shape library out from under a seller
  // who just opened it.
  const colorTarget = leftPanel?.kind === "color" ? leftPanel.ref : null;
  function setColorTarget(ref: ColorTargetRef | null) {
    if (ref) setLeftPanel({ kind: "color", ref });
    else setLeftPanel((current) => (current?.kind === "color" ? null : current));
  }
  // The free cell the seller clicked, so the next inserted block lands there.
  const [insertHint, setInsertHint] = useState<{ x: number; y: number } | null>(
    null,
  );
  // Pan + zoom live here, OUTSIDE React state, and are written straight to
  // the stage each frame. Gestures therefore cause no re-renders at all.
  const viewport = useCanvasViewport({ zoom: 1, pan: { x: 0, y: 0 } });
  // True while a pan gesture is running, so the cursor can say so.
  const [panning, setPanning] = useState(false);
  // Space held = temporary pan tool, the shortcut every canvas app shares.
  const [spaceHeld, setSpaceHeld] = useState(false);
  // The window the board moves behind: owns wheel pan/zoom and fit.
  const canvasViewportRef = useRef<HTMLElement>(null);
  // Preview device for the canvas frame — switched from DesignerCanvas's own
  // device switch, anchored above whatever it is currently showing, never
  // persisted.
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">(
    "desktop",
  );
  /**
   * The pannable canvas is showing — design view, or mobile preview with a
   * product page open beside the board. A page has nowhere to go "beside"
   * the plain scrolling column mobile preview is otherwise, so opening one
   * switches the workspace into the same canvas desktop already uses: same
   * artboard, same connector line, same pan/zoom, just sized for the device
   * currently selected. Closing the last open page (or none ever being
   * opened) drops mobile preview straight back to the fluid column.
   */
  const designView = previewMode === "desktop" || openPages.length > 0;
  const history = useEditorHistory<EditorSnapshot>();
  // Prompt to save/discard when leaving with unsaved edits (Back link, browser
  // Back button, refresh/close). `dirty` alone drives whether it's armed.
  const leaveGuard = useUnsavedChangesGuard(dirty, "/storefront");

  const productsById = useMemo(
    () => new Map(catalog.map((product) => [product.id, product])),
    [catalog],
  );

  /** Whether any product page is out on the canvas. */
  const pageOpen = openPages.length > 0;

  // What the design panel's search field can find. Rebuilt when the board or
  // the catalogue changes, because half of this index IS the board: the
  // objects on it are searchable by the same names the layers list shows.
  //
  // It also tracks whether a page is out. The product page's settings are only
  // offered while the page they describe is on screen; with none out they
  // collapse to a single row that opens one, so the same words still answer
  // and what they answer with is the step that has to come first anyway.
  const editorSearchEntries = useMemo(
    () => editorEntries(blocks, productsById, { pageOpen }),
    [blocks, productsById, pageOpen],
  );
  const usedProductIds = useMemo(
    () =>
      new Set(
        blocks
          .filter((block) => block.type === "product")
          .map((block) => block.productId),
      ),
    [blocks],
  );
  // The blocks whose card the inspector shows, in selection order. Deriving
  // (not storing) means removed/undone-away blocks simply drop out of the
  // selection instead of going stale.
  const selectedBlocks = useMemo<StorefrontBlock[]>(() => {
    if (inspector?.kind !== "blocks") return [];
    const byKey = new Map(blocks.map((b) => [blockKey(b), b]));
    return inspector.keys
      .map((key) => byKey.get(key))
      .filter((b): b is StorefrontBlock => b !== undefined);
  }, [blocks, inspector]);
  const selectedKeys = useMemo(
    () => selectedBlocks.map(blockKey),
    [selectedBlocks],
  );
  /** The single selection, when exactly one block is selected. */
  const selectedBlock = selectedBlocks.length === 1 ? selectedBlocks[0] : null;

  // Which product a "show me the page" request means when it does not name
  // one: the selected tile, else the first product on the board. Null when the
  // board holds no products, which is when there is no page to show.
  const defaultPageProductId = useMemo<string | null>(() => {
    const selected = selectedBlocks.find((block) => block.type === "product");
    if (selected?.type === "product") return selected.productId;
    const first = readingOrder(blocks).find(
      (block) => block.type === "product" && productsById.has(block.productId),
    );
    return first?.type === "product" ? first.productId : null;
  }, [selectedBlocks, blocks, productsById]);

  // The colors already on the canvas, for the left panel's "In this design".
  const colorsInDesign = useMemo(
    () => collectStorefrontColors(theme, blocks, header),
    [theme, blocks, header],
  );

  /**
   * TYPING MODE: a text block's words, typed on the tile itself rather than in
   * a field in the panel. Held apart from the selection for the same reason
   * frame mode is — "which block's settings are open" and "which block is
   * taking keystrokes right now" are different questions — and mirrored into a
   * ref so the document-level shortcut listeners can read it without
   * re-subscribing.
   *
   * `selectAll` opens the editor with the text selected instead of a caret at
   * the end: right for a block that was just inserted and still says "Your
   * text here", wrong for one the seller is coming back to.
   *
   * `typingRange` is the selection INSIDE that editor, in character offsets,
   * and is what makes "colour these two words" possible: a colour picked while
   * part of the text is selected lands on that range instead of on the block.
   * It lives up here because the picker that sends the colour is on the other
   * side of the tree, and because the panel resolves against it below.
   */
  const [typing, setTyping] = useState<{
    key: string;
    selectAll: boolean;
  } | null>(null);
  const typingRef = useRef<string | null>(null);
  const [typingRange, setTypingRange] = useState<TextRange | null>(null);

  /**
   * The same thing for the MASTHEAD: double-clicking the store name or the bio
   * types it where it reads, instead of sending the seller to the panel's
   * fields for the words and back to the canvas for how they look.
   *
   * `range` is the selection the click left behind — the word a double-click
   * landed on — so the first keystroke replaces exactly what was aimed at.
   */
  const [headerEdit, setHeaderEdit] = useState<{
    line: HeaderLine;
    range: TextRange | null;
  } | null>(null);

  /** The selected block, when it is a text block with live selected words —
   *  i.e. when a colour would land on part of the text rather than all of it. */
  const textRangeTarget =
    selectedBlock?.type === "text" &&
    typing?.key === blockKey(selectedBlock) &&
    typingRange !== null &&
    typingRange.start !== typingRange.end
      ? { block: selectedBlock, range: typingRange }
      : null;

  /**
   * The panel's target against LIVE state. Null when it no longer names
   * anything — the block was deleted or undone away, or the background changed
   * to a kind with no such color — so the panel closes instead of editing a
   * ghost.
   */
  const resolvedColorTarget = colorTarget
    ? resolveColorTarget(
        colorTarget,
        theme,
        blocks,
        header,
        textRangeTarget
          ? {
              blockKey: blockKey(textRangeTarget.block),
              range: textRangeTarget.range,
            }
          : null,
        // A line emptied while it is being typed in is still on the board, as
        // a field with a caret in it. Without this the panel would close under
        // the seller the moment they cleared the words to retype them — and
        // the panel's target is what keeps the field open.
        headerEdit?.line ?? null,
      )
    : null;

  // What the rest of the tree is told is active. Derived rather than corrected
  // in an effect: a ref that has stopped resolving is simply not active, and
  // nothing downstream should see it as such.
  const activeColorTarget = resolvedColorTarget ? colorTarget : null;

  /** Which masthead line the canvas should show as selected, if any. Falls out
   *  of the same target the panel is on, so the two can never disagree. */
  const activeHeaderLine: HeaderLine | null =
    activeColorTarget?.kind === "header-name"
      ? "name"
      : activeColorTarget?.kind === "header-bio"
        ? "bio"
        : null;

  /** Which line is taking keystrokes. Derived against the panel's target the
   *  same way, so anything that aims the panel elsewhere — clicking a tile,
   *  an undo that takes the masthead away — ends the edit on its own rather
   *  than leaving a caret in a line nothing is pointing at. */
  const editingHeaderLine: HeaderLine | null =
    headerEdit && headerEdit.line === activeHeaderLine ? headerEdit.line : null;

  // The panel is open when it has something to show. A color ref that has
  // stopped resolving counts as nothing, which is what closes the panel on
  // its own when the block it named is deleted or undone away.
  const leftPanelOpen =
    leftPanel?.kind === "library" ||
    (resolvedColorTarget !== null && activeColorTarget !== null);

  /**
   * The DISTINCT artwork this storefront uses, for the library's Uploads tab.
   *
   * Keyed by the R2 object key, not by block: placing one logo in three
   * corners is three blocks sharing a single upload, and the chooser should
   * offer it once. The first block using a key also lends its alt text as the
   * label, which is the only human name an upload ever has.
   */
  const uploads = useMemo<StorefrontUpload[]>(() => {
    const byKey = new Map<string, StorefrontUpload>();
    for (const block of blocks) {
      if (block.type !== "image" || byKey.has(block.key)) continue;
      byKey.set(block.key, {
        key: block.key,
        url: elementUrls[blockKey(block)] ?? null,
        alt: block.alt,
      });
    }
    return [...byKey.values()];
  }, [blocks, elementUrls]);

  function markDirty() {
    setDirty(true);
  }

  /** The undoable state as it stands right now. */
  const snapshot = (): EditorSnapshot => ({
    theme,
    header,
    blocks,
    productPage,
  });

  /** Every undoable mutation calls this FIRST with an optional coalesce key. */
  function recordChange(coalesceKey?: string) {
    history.record(snapshot(), coalesceKey);
    markDirty();
  }

  function applySnapshot(next: EditorSnapshot) {
    setTheme(next.theme);
    setHeader(next.header);
    setBlocks(next.blocks);
    setProductPage(next.productPage);
    markDirty();
  }

  function undo() {
    const previous = history.undo(snapshot());
    if (previous) applySnapshot(previous);
  }

  function redo() {
    const next = history.redo(snapshot());
    if (next) applySnapshot(next);
  }

  // Ctrl/Cmd+Z / Shift+Z / Y. The listener subscribes ONCE and reads the
  // latest handlers through a ref, so renders never churn add/removeListener.
  // Skipped while typing (text fields keep their native undo) and while a
  // custom Select dropdown is open (its trigger is a button, not an input).
  const historyActions = useRef({ undo, redo });
  useEffect(() => {
    historyActions.current = { undo, redo };
  });
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable ||
          target.closest('[role="combobox"][aria-expanded="true"]') !== null)
      ) {
        return;
      }
      event.preventDefault();
      if (key === "y" || event.shiftKey) historyActions.current.redo();
      else historyActions.current.undo();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // The wheel drives the workspace: Ctrl/Cmd (or a trackpad pinch, which
  // arrives as the same event) zooms about the pointer; a plain scroll pans.
  // Every event mutates the viewport ref SYNCHRONOUSLY, so a burst of events
  // accumulates instead of each one recomputing from a stale origin.
  // Registered non-passively so the browser's own scroll/zoom is preventable.
  useEffect(() => {
    const area = canvasViewportRef.current;
    if (!area) return;
    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const { x: deltaX, y: deltaY } = normalizeWheel(event);
      if (event.ctrlKey || event.metaKey) {
        const rect = area!.getBoundingClientRect();
        const anchorX = event.clientX - rect.left;
        const anchorY = event.clientY - rect.top;
        viewport.set((current) => {
          const zoom = clampZoom(current.zoom * Math.exp(-deltaY / 300));
          return {
            zoom,
            pan: panAfterZoom(current.pan, current.zoom, zoom, anchorX, anchorY),
          };
        });
        return;
      }
      viewport.set((current) => ({
        zoom: current.zoom,
        pan: { x: current.pan.x - deltaX, y: current.pan.y - deltaY },
      }));
    }
    area.addEventListener("wheel", onWheel, { passive: false });
    return () => area.removeEventListener("wheel", onWheel);
  }, [viewport]);

  /**
   * PANELS MOVE, THE BOARD DOES NOT.
   *
   * Opening the colour column used to shove the whole design 280px sideways,
   * because the pan is measured from the workspace's top-left corner and a
   * docked panel moves that corner. This holds the board on the same pixels of
   * the screen through any panel opening, closing, resizing or turning into a
   * bottom sheet, and moves it ONLY when a panel is genuinely standing on it,
   * by the least amount that gets it back out. It also re-clamps on a window
   * resize, which is what this used to be on its own.
   *
   * Selected blocks come along as the thing most worth keeping in view: on a
   * phone a sheet can take 70% of the screen, where revealing the whole board
   * is impossible but revealing the one tile being edited is not.
   */
  useCanvasAnchor({
    viewport,
    workspaceRef: canvasViewportRef,
    enabled: designView,
    anchorKeys: selectedKeys,
  });

  // Space = hold-to-pan. Ignored while typing, and while a button has focus
  // (there space is that button's activation key).
  useEffect(() => {
    function isTypingTarget(target: EventTarget | null): boolean {
      const element = target as HTMLElement | null;
      if (!element) return false;
      return (
        element.tagName === "INPUT" ||
        element.tagName === "TEXTAREA" ||
        element.tagName === "BUTTON" ||
        element.isContentEditable
      );
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.code !== "Space" || isTypingTarget(event.target)) return;
      event.preventDefault();
      setSpaceHeld(true);
    }
    function onKeyUp(event: KeyboardEvent) {
      if (event.code === "Space") setSpaceHeld(false);
    }
    // A lost window (alt-tab mid-hold) would otherwise strand the pan tool.
    function onBlur() {
      setSpaceHeld(false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  /**
   * Delete / Backspace removes the selected block — the shortcut every canvas
   * tool has. Same subscribe-once + ref shape as the undo listener above, so
   * selecting a tile never churns add/removeListener.
   *
   * Guarded on the event target, not just on "is something selected": the
   * inspector for the selected block is full of fields (the text block's
   * textarea, a product's name and price, the hex input), and a Backspace
   * there must edit the value the seller is typing, never delete the tile
   * they are typing about. Modified presses are left alone too — Cmd/Alt +
   * Backspace are word/line deletes that belong to whatever has focus.
   *
   * preventDefault because Backspace outside a field is historically "go
   * back", and losing unsaved design work to a navigation would be brutal.
   */
  const deleteShortcut = useRef<{ selectedKeys: readonly string[] }>({
    selectedKeys: [],
  });
  useEffect(() => {
    deleteShortcut.current.selectedKeys = selectedKeys;
  });
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      // Framing a picture is not a moment to delete the tile under it. The
      // framed block is always selected, so without this the key that means
      // "nudge nothing" would silently destroy the thing being worked on.
      if (framingKeyRef.current !== null) return;
      const keys = deleteShortcut.current.selectedKeys;
      if (keys.length === 0) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      canvasActions.current.removeBlocks(keys);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /**
   * Ctrl/Cmd + B / I / U on the CANVAS: format every selected text block.
   *
   * The in-place editor handles the same keys while the caret is in a tile
   * (there they can apply to just the selected words), so this listener stays
   * out of any field — the guard below is the same one every other shortcut
   * here uses. Blocks that are not text simply ignore it, so a mixed selection
   * bolds its text and leaves the rest alone.
   */
  const formatShortcut = useRef<{
    selectedKeys: readonly string[];
    headerLine: HeaderLine | null;
  }>({ selectedKeys: [], headerLine: null });
  useEffect(() => {
    formatShortcut.current.selectedKeys = selectedKeys;
    formatShortcut.current.headerLine = headerLineOf(activeColorTarget);
  });
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key !== "b" && key !== "i" && key !== "u") return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      const { selectedKeys: keys, headerLine } = formatShortcut.current;
      if (keys.length === 0 && headerLine === null) return;
      // Ctrl+B and Ctrl+I are the browser's bookmark/history bars; Ctrl+U is
      // view-source. None of them may fire over a design.
      event.preventDefault();
      const format = key === "b" ? "bold" : key === "i" ? "italic" : "underline";
      // A masthead line is styled the same way from the keyboard as a block,
      // even though it lives on the header rather than in the grid.
      if (keys.length === 0 && headerLine) {
        canvasActions.current.toggleHeaderFormat(headerLine, format);
        return;
      }
      canvasActions.current.toggleBlocksFormat(keys, format);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /**
   * Ctrl/Cmd + [ and ] walk the selection through the stack, with Shift
   * sending it the whole way. These are the Figma and Illustrator bindings, so
   * they are what a seller who has used either reaches for first.
   *
   * preventDefault is REQUIRED rather than tidy: on macOS Cmd+[ and Cmd+] are
   * Back and Forward, and an editor that navigated away here would take the
   * unsaved board with it.
   *
   * Same subscribe-once + ref shape and the same guards as every other
   * shortcut in this file, the Select guard included: its trigger is a button
   * rather than an input, so the "am I typing" test alone does not catch it.
   */
  const layerShortcut = useRef<{ selectedKeys: readonly string[] }>({
    selectedKeys: [],
  });
  useEffect(() => {
    layerShortcut.current.selectedKeys = selectedKeys;
  });
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      // Shift changes the CHARACTER these keys produce (] becomes }), so the
      // jump-to-the-end half of the binding would never fire if this matched
      // on `key` alone. `code` names the physical key, which is what a
      // shortcut borrowed from Figma is really about.
      const forward =
        event.code === "BracketRight" || event.key === "]" || event.key === "}";
      const backward =
        event.code === "BracketLeft" || event.key === "[" || event.key === "{";
      if (!forward && !backward) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable ||
          target.closest('[role="combobox"][aria-expanded="true"]') !== null)
      ) {
        return;
      }
      const keys = layerShortcut.current.selectedKeys;
      if (keys.length === 0) return;
      event.preventDefault();
      const op: LayerOp = forward
        ? event.shiftKey
          ? "front"
          : "forward"
        : event.shiftKey
          ? "back"
          : "backward";
      canvasActions.current.reorderLayers(keys, op);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Cmd/Ctrl +/-/0, the shortcuts every canvas tool shares.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey)) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        viewActions.current.zoomBy(ZOOM_STEP);
      } else if (event.key === "-") {
        event.preventDefault();
        viewActions.current.zoomBy(-ZOOM_STEP);
      } else if (event.key === "0") {
        event.preventDefault();
        viewActions.current.resetZoom();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // The inspector and the mobile settings sheet share the small screen — at
  // most one is open at a time.
  /**
   * Click selection. Plain click: select just this block, or deselect when it
   * is already the sole selection (the tile is a toggle). Shift-click
   * (`additive`): add the block to the selection, or drop it back out.
   */
  /**
   * `justInserted` is how a freshly added block opens the color panel: it is not
   * in `blocks` yet at this point in the tick (setBlocks has been called but the
   * state has not re-rendered), so looking it up by key would find nothing.
   */
  function selectBlock(
    key: string | null,
    additive = false,
    justInserted?: StorefrontBlock,
  ) {
    // Any selection change is the end of framing (and of typing): you cannot
    // be positioning one tile's picture, or typing its words, while working on
    // another.
    if (framingKeyRef.current !== null && framingKeyRef.current !== key) {
      exitFrameMode();
    }
    if (typingRef.current !== null && typingRef.current !== key) endTyping();
    if (key === null) {
      setInspector((current) => (current?.kind === "blocks" ? null : current));
      return;
    }
    const wasSole =
      inspector?.kind === "blocks" &&
      inspector.keys.length === 1 &&
      inspector.keys[0] === key;
    setInspector((current) => {
      const keys = current?.kind === "blocks" ? current.keys : [];
      if (additive) {
        const next = keys.includes(key)
          ? keys.filter((k) => k !== key)
          : [...keys, key];
        return next.length > 0 ? { kind: "blocks", keys: next } : null;
      }
      if (keys.length === 1 && keys[0] === key) return null;
      return { kind: "blocks", keys: [key] };
    });
    // Open the color panel on the block's leading color — but ONLY for a plain
    // click. Shift-click is building a multi-selection, where one block's color
    // is not what is being edited.
    //
    // Deliberately NOT driven off the selection state: the marquee below
    // rewrites the selection on every pointer move, and a panel that opened
    // and closed mid-drag would resize the canvas under the pointer the drag is
    // being measured against.
    //
    // And NOT while the library is open, which is the case that made this a
    // rule rather than a preference: adding a shape selects it, and selecting
    // it would swap the left panel to that shape's fill — closing the very
    // library the seller was picking from, one shape in. The panel stays;
    // reaching for a colour deliberately (an inspector picker) still opens it.
    //
    // AND NOT ON A PHONE AT ALL. On a compact surface the colour panel is not a
    // column beside the board but a sheet over it, taking 55vh of a screen that
    // had about 300px of workspace to begin with: touching a block to move it
    // buried the board under a picker nobody asked for, and the way back was to
    // shut a panel first. So a selection there opens nothing, and colour is
    // reached the way every other tile action is, by pressing for it in the
    // selection toolbar. It still CLOSES one: leaving a sheet open on the block
    // that was selected a moment ago would be a picker pointed at the wrong
    // thing.
    if (!additive && leftPanel?.kind !== "library") {
      const block = wasSole
        ? null
        : (justInserted ?? blocks.find((b) => blockKey(b) === key));
      setColorTarget(
        block && surface === "regular" ? primaryColorTarget(block) : null,
      );
    }
    setSettingsOpen(false);
  }

  /** Replace the whole selection (the marquee's channel). Empty = clear.
   *  Leaves the color panel alone: see the note in selectBlock. */
  function selectMany(keys: string[]) {
    setInspector(keys.length > 0 ? { kind: "blocks", keys } : null);
    if (keys.length > 0) setSettingsOpen(false);
    // A marquee press preventDefaults, so the tile being typed in never loses
    // focus on its own; rubber-banding over the board has to end the edit.
    if (typingRef.current !== null) endTyping();
  }

  /**
   * Clicking the store name or bio on the canvas aims the left-hand panel at
   * that line, which is where its colour and size are set. The masthead is not
   * a block, so it takes no part in the block selection: a click here clears
   * that instead, exactly as clicking anything else on the board would.
   */
  function selectHeaderLine(line: HeaderLine) {
    setInspector((current) => (current?.kind === "blocks" ? null : current));
    openColorTarget(line === "name" ? { kind: "header-name" } : { kind: "header-bio" });
  }

  /**
   * Double-clicking a masthead line (or clicking the one the panel is already
   * on) puts the caret in it. The panel comes along, aimed at the same line:
   * the words and the way they look are the one thing being edited, and the
   * panel's target is also what keeps this mode alive (see editingHeaderLine).
   */
  function beginHeaderEdit(line: HeaderLine, range: TextRange | null) {
    if (typingRef.current !== null) endTyping();
    selectHeaderLine(line);
    setHeaderEdit({ line, range });
  }

  function endHeaderEdit() {
    setHeaderEdit(null);
  }

  /** A keystroke in the masthead. Coalesced into one undo step per line by the
   *  key updateHeader derives, exactly like typing on a text tile. */
  function setHeaderLineText(line: HeaderLine, value: string) {
    if (header[line] === value) return;
    updateHeader({ ...header, [line]: value });
  }

  /** Clicking a free cell opens the picker; whatever is added next lands in
   *  that cell rather than the first free one. */
  function insertAt(x: number, y: number) {
    setInsertHint({ x, y });
    setInspector({ kind: "picker" });
    setSettingsOpen(false);
    // Same reason as togglePicker: the picker needs the slot the colour sheet
    // would otherwise be holding on a phone.
    setColorTarget(null);
  }

  /** Consume the pending insert cell (one use only). */
  function takeInsertHint(): { x: number; y: number } | undefined {
    const hint = insertHint ?? undefined;
    if (hint) setInsertHint(null);
    return hint;
  }

  /** The board's UNSCALED size (offsetWidth/Height ignore transforms, so these
   *  are the natural dimensions). Where it should GO is safeWindow's answer. */
  function measureView() {
    const stage = viewport.stage();
    if (!stage || stage.offsetWidth <= 0) return null;
    return { width: stage.offsetWidth, height: stage.offsetHeight };
  }

  /**
   * The part of the workspace no panel is standing on, in workspace
   * coordinates (which is what the pan is measured in).
   *
   * Everything that PLACES the board rather than nudging it reads this instead
   * of the raw box: centring a board in a window whose bottom 60% is a sheet
   * would centre it under the sheet, and fitting it to that window would size
   * it for room it does not have. On desktop the docked panels are laid out
   * beside the workspace, so this is simply the whole box.
   */
  function safeWindow() {
    const area = canvasViewportRef.current;
    if (!area) return null;
    const insets = viewport.insets();
    const [minX, maxX] = safeSpan(area.clientWidth, insets.left, insets.right);
    const [minY, maxY] = safeSpan(area.clientHeight, insets.top, insets.bottom);
    return {
      minX,
      minY,
      width: maxX - minX,
      height: maxY - minY,
      midX: (minX + maxX) / 2,
      midY: (minY + maxY) / 2,
    };
  }

  /** Drop the board in the middle of the workspace at the given scale. */
  function centerCanvas(atZoom: number) {
    const view = measureView();
    const room = safeWindow();
    if (!view || !room) return;
    viewport.set({
      zoom: atZoom,
      pan: {
        x: room.minX + (room.width - view.width * atZoom) / 2,
        y:
          room.minY +
          Math.max(CANVAS_MARGIN, (room.height - view.height * atZoom) / 2),
      },
    });
  }

  /** Toolbar zoom: about the middle of the window, not the corner. */
  function zoomBy(delta: number) {
    const room = safeWindow();
    viewport.set((current) => {
      const zoom = clampZoom(current.zoom + delta);
      if (!room) return { ...current, zoom };
      return {
        zoom,
        pan: panAfterZoom(current.pan, current.zoom, zoom, room.midX, room.midY),
      };
    });
  }

  function resetZoom() {
    centerCanvas(1);
  }

  // The one-shot listeners below read these through a ref, so they never
  // need re-subscribing when a render changes the closures.
  const viewActions = useRef({ zoomBy, resetZoom });
  useEffect(() => {
    viewActions.current = { zoomBy, resetZoom };
  });

  // Identity-stable canvas callbacks. The canvas is memoised, so a render
  // caused by something it does not display (typing the storefront name, for
  // instance) must not hand it fresh function props — that alone re-rendered
  // every tile, measured at 46ms per keystroke on a full board.
  const canvasActions = useRef({
    moveBlock,
    resizeBlock,
    rotateBlocks,
    reorderLayers,
    removeBlock,
    removeBlocks,
    insertAt,
    selectBlock,
    selectMany,
    frameBlock,
    updateImagePlacement,
    exitFrameMode,
    beginTyping,
    setBlockText,
    toggleBlockFormat,
    toggleBlocksFormat,
    toggleHeaderFormat,
    endTyping,
    selectHeaderLine,
    beginHeaderEdit,
    setHeaderLineText,
    endHeaderEdit,
  });
  useEffect(() => {
    canvasActions.current = {
      moveBlock,
      resizeBlock,
      rotateBlocks,
      reorderLayers,
      removeBlock,
      removeBlocks,
      insertAt,
      selectBlock,
      selectMany,
      frameBlock,
      updateImagePlacement,
      exitFrameMode,
      beginTyping,
      setBlockText,
      toggleBlockFormat,
      toggleBlocksFormat,
      toggleHeaderFormat,
      endTyping,
      selectHeaderLine,
      beginHeaderEdit,
      setHeaderLineText,
      endHeaderEdit,
    };
  });
  const onMoveBlock = useCallback((key: string, x: number, y: number) => {
    canvasActions.current.moveBlock(key, x, y);
  }, []);
  const onResizeBlock = useCallback((key: string, placement: BlockPlacement) => {
    canvasActions.current.resizeBlock(key, placement);
  }, []);
  const onRotateBlock = useCallback((key: string, rotation: number) => {
    // The handle turns ONE tile, even when several are selected: the tile the
    // hand is on is the one it means.
    canvasActions.current.rotateBlocks([key], rotation);
  }, []);
  const onInsertAt = useCallback((x: number, y: number) => {
    canvasActions.current.insertAt(x, y);
  }, []);
  const onSelectBlock = useCallback((key: string | null, additive?: boolean) => {
    canvasActions.current.selectBlock(key, additive);
  }, []);
  const onSelectMany = useCallback((keys: string[]) => {
    canvasActions.current.selectMany(keys);
  }, []);
  const onSelectHeaderLine = useCallback((line: HeaderLine) => {
    canvasActions.current.selectHeaderLine(line);
  }, []);
  const onEditHeaderLine = useCallback(
    (line: HeaderLine, range: TextRange | null) => {
      canvasActions.current.beginHeaderEdit(line, range);
    },
    [],
  );
  const onHeaderTextChange = useCallback((line: HeaderLine, value: string) => {
    canvasActions.current.setHeaderLineText(line, value);
  }, []);
  const onToggleHeaderFormat = useCallback(
    (line: HeaderLine, format: "bold" | "italic" | "underline") => {
      canvasActions.current.toggleHeaderFormat(line, format);
    },
    [],
  );
  const onHeaderEditEnd = useCallback(() => {
    canvasActions.current.endHeaderEdit();
  }, []);
  const onFrameBlock = useCallback((key: string) => {
    canvasActions.current.frameBlock(key);
  }, []);
  const onFramePlacement = useCallback(
    (key: string, placement: ImagePlacement) => {
      canvasActions.current.updateImagePlacement(key, placement);
    },
    [],
  );
  const onFrameExit = useCallback(() => {
    canvasActions.current.exitFrameMode();
  }, []);
  const onTypeStart = useCallback((key: string) => {
    canvasActions.current.beginTyping(key);
  }, []);
  const onTextChange = useCallback(
    (key: string, text: string, spans: TextSpan[], source: TextEditSource) => {
      canvasActions.current.setBlockText(key, text, spans, source);
    },
    [],
  );
  const onToggleBlockFormat = useCallback(
    (key: string, format: InlineFormatKey) => {
      canvasActions.current.toggleBlockFormat(key, format);
    },
    [],
  );
  const onTypeEnd = useCallback(() => {
    canvasActions.current.endTyping();
  }, []);

  /**
   * Scale the whole board to fit the window, then centre it. Used ONLY for the
   * first paint, when the board is wider than the workspace (always the case on
   * a phone) — without it the editor would open cropped at 100% with the
   * content off-screen. There is deliberately no "zoom to fit" control: zoom is
   * a per-gesture thing, and the toolbar reads better with fewer buttons.
   */
  function fitOnFirstPaint() {
    const view = measureView();
    const room = safeWindow();
    if (!view || !room) return;
    const zoom = clampZoom(
      Math.min(
        (room.width - CANVAS_MARGIN * 2) / view.width,
        (room.height - CANVAS_MARGIN * 2) / view.height,
      ),
    );
    viewport.set({
      zoom,
      pan: {
        x: room.minX + (room.width - view.width * zoom) / 2,
        // Top-aligned, NOT vertically centred. A fitted board is short relative
        // to the window (on a phone it lands around half the height), and
        // centring it left a dead band across the top of the screen with the
        // content stranded in the middle. Starting at the top puts the board
        // where the eye lands and leaves the free space at the bottom, where
        // the sheets and toolbar live anyway.
        y: room.minY + CANVAS_MARGIN,
      },
    });
  }

  /**
   * Two-finger pinch: the ONLY way to zoom on a phone, where the toolbar's
   * zoom buttons are hidden (they cost more thumb-width than they are worth).
   * The workspace sets `touch-none`, so no native gesture competes and we get
   * raw pointer events for both fingers.
   *
   * Tracked here rather than in the canvas because zoom and pan live on the
   * viewport store this component owns.
   */
  const touchPoints = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{
    distance: number;
    zoom: number;
    midX: number;
    midY: number;
    pan: { x: number; y: number };
  } | null>(null);

  function pinchGeometry() {
    const [a, b] = [...touchPoints.current.values()];
    return {
      distance: Math.hypot(b.x - a.x, b.y - a.y),
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
    };
  }

  function onCanvasPointerDown(event: React.PointerEvent<HTMLElement>) {
    if (event.pointerType === "touch") {
      touchPoints.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      if (touchPoints.current.size === 2) {
        const { distance, midX, midY } = pinchGeometry();
        pinchStart.current = {
          distance,
          zoom: viewport.get().zoom,
          midX,
          midY,
          pan: { ...viewport.get().pan },
        };
        // A finger may already be dragging a tile or panning. Both of those
        // end on pointercancel, so this hands the gesture over cleanly instead
        // of letting a tile follow one finger through the pinch.
        window.dispatchEvent(new PointerEvent("pointercancel"));
        return;
      }
    }
    startPan(event);
  }

  function onCanvasPointerMove(event: React.PointerEvent<HTMLElement>) {
    if (event.pointerType !== "touch") return;
    if (!touchPoints.current.has(event.pointerId)) return;
    touchPoints.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    const start = pinchStart.current;
    if (!start || touchPoints.current.size !== 2) return;
    event.preventDefault();

    const { distance, midX, midY } = pinchGeometry();
    if (start.distance === 0) return;
    const zoom = clampZoom((distance / start.distance) * start.zoom);
    // Keep the board point that started under the pinch centre pinned there,
    // then add however far the centre itself travelled (pinch pans too).
    const pinned = panAfterZoom(start.pan, start.zoom, zoom, start.midX, start.midY);
    viewport.set(() => ({
      zoom,
      pan: {
        x: pinned.x + (midX - start.midX),
        y: pinned.y + (midY - start.midY),
      },
    }));
  }

  function onCanvasPointerUp(event: React.PointerEvent<HTMLElement>) {
    if (event.pointerType !== "touch") return;
    touchPoints.current.delete(event.pointerId);
    // Lifting one finger ends the pinch; it does NOT resume a pan, or the
    // board would jump to track the remaining finger.
    if (touchPoints.current.size < 2) pinchStart.current = null;
  }

  // A finger can leave the workspace before it lifts, and then the element's
  // own pointerup never fires. Without this the id would stay in the map and
  // the next single touch would look like a second finger, starting a phantom
  // pinch. Pruning on window catches the release wherever it happens.
  useEffect(() => {
    function prune(event: PointerEvent) {
      touchPoints.current.delete(event.pointerId);
      if (touchPoints.current.size < 2) pinchStart.current = null;
    }
    window.addEventListener("pointerup", prune);
    window.addEventListener("pointercancel", prune);
    return () => {
      window.removeEventListener("pointerup", prune);
      window.removeEventListener("pointercancel", prune);
    };
  }, []);

  /**
   * Is this press on empty workspace, as opposed to on something?
   *
   * The obvious test (did the press land on the workspace element itself) is
   * not enough, because the stage is a FLEX ROW: the gap it leaves between
   * the board and the pages beside it, and the band above them the connectors
   * run through, are all inside the stage's own box, so a press there hits the
   * stage rather than the workspace behind it. It is still empty space, and
   * grabbing empty space is how the seller drags the whole workspace around,
   * a rule that got noticeably worse to live with once pages could sit beside
   * the board, since that gap is exactly where the hand reaches for.
   *
   * So: anywhere inside the stage that is neither the board, nor a page, nor
   * a control on the chrome around them (the device switches and the close
   * buttons ride the stage too, and a press on one belongs to that button).
   */
  function isWorkspaceBackground(event: React.PointerEvent<HTMLElement>): boolean {
    if (event.target === event.currentTarget) return true;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || !target.closest("[data-canvas-stage]")) return false;
    if (target.closest("[data-canvas-board], [data-artboard-id]")) return false;
    return (
      target.closest(
        "button, a, input, select, textarea, [contenteditable='true'], [role='button'], [role='switch']",
      ) === null
    );
  }

  /**
   * MAY A ONE-FINGER DRAG STARTING HERE MOVE THE WHOLE WORKSPACE?
   *
   * A pointer has three ways to pan: the middle button, space held, and a press
   * on the bare workspace. Touch has none of the first two, and on a phone it
   * effectively has none of the third either. The board is fitted to a ~300px
   * strip, so it IS the workspace, and the bare margin a desktop drags by is a
   * few pixels down each side. Panning was therefore reachable on a phone in
   * theory and not in practice, which matters more here than on a desktop: with
   * no room to zoom out, moving the board is the only way to reach the parts of
   * it currently off screen.
   *
   * So on touch the whole surface pans, minus the things that already own a
   * drag of their own:
   *
   * - TILES drag themselves (Grid's startMove), and the resize/rotate handles
   *   stop propagation before this ever sees them.
   * - TEXT keeps its caret and its selection drag.
   *
   * Buttons are deliberately NOT excluded, and the empty grid cells are the
   * reason: they are buttons covering nearly all the open board, so excluding
   * them would leave the gesture with nothing to start on again. What protects
   * their click is that this pan does not commit on contact: it stays dormant
   * until the finger has travelled, and only a press that never travels is
   * still a tap. Same bargain the marquee makes on a desktop.
   */
  function isTouchPanTarget(event: React.PointerEvent<HTMLElement>): boolean {
    if (event.pointerType !== "touch") return false;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || !target.closest("[data-canvas-stage]")) return false;
    if (target.closest("[data-grid-key]")) return false;
    return (
      target.closest("input, select, textarea, [contenteditable='true']") === null
    );
  }

  /**
   * Pan gestures: the middle button, space held, a left-press that landed on
   * the workspace BACKGROUND (dragging beside the board moves it, while a press
   * on a tile still drags that tile), or a one-finger touch drag anywhere the
   * rule above allows.
   */
  function startPan(event: React.PointerEvent<HTMLElement>) {
    const onBackground = isWorkspaceBackground(event);
    // Only where the background rule has already declined: a press on real
    // empty space is the existing gesture and keeps its existing behaviour
    // (committing at once, and clearing the selection when it goes nowhere).
    const deferred = !onBackground && isTouchPanTarget(event);
    const wanted =
      event.button === 1 ||
      (event.button === 0 && (spaceHeld || onBackground || deferred));
    if (!wanted) return;
    // A deferred pan may still turn out to be a tap on whatever is under the
    // finger, so nothing is claimed from it yet.
    if (!deferred) event.preventDefault();

    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { ...viewport.get().pan };
    // A press on the empty workspace that never travels is a CLICK on nothing,
    // and clicking on nothing means "I am done with that block". Only for the
    // plain background press: space-held is the pan tool, where a click is
    // just a pan that went nowhere.
    const clearsSelection = onBackground && !spaceHeld && event.button === 0;
    let travelled = false;
    if (!deferred) setPanning(true);

    function onMove(moveEvent: PointerEvent) {
      if (
        !travelled &&
        Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 4
      ) {
        travelled = true;
        if (deferred) setPanning(true);
      }
      // Dormant until it travels; see isTouchPanTarget.
      if (deferred && !travelled) return;
      viewport.set((current) => ({
        zoom: current.zoom,
        pan: {
          x: origin.x + (moveEvent.clientX - startX),
          y: origin.y + (moveEvent.clientY - startY),
        },
      }));
    }
    function stop() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      setPanning(false);
      // The press was spent on the pan, so the click the browser synthesises
      // after it is not a tap on anything: let it through and the empty cell
      // the finger LIFTED over would insert a block. Same swallow the canvas
      // does after a marquee drag, from out here because the press may have
      // begun on a control the canvas never sees.
      if (deferred && travelled) swallowNextClick();
      // selectBlock(null) also ends frame mode, so one click on the empty
      // workspace backs out of everything at once.
      if (clearsSelection && !travelled) {
        selectBlock(null);
        dismissPanels();
      }
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }

  /**
   * PUT THE PANELS AWAY. What a press on bare canvas that went nowhere means:
   * the seller pointed at nothing, so nothing should be on screen.
   *
   * On a phone that is every panel, because every panel is a sheet lying over
   * the board, and a sheet nobody can dismiss by looking away from it is a
   * sheet you have to hunt for a close button to escape. On `lg` and up the
   * right-hand column is furniture rather than cover, and the stack is a place
   * a seller sits and works from, so neither is swept away by a deselect. The
   * floating left layer goes on both: it opened FOR the thing that was just
   * deselected, so it has nothing left to be about.
   */
  function dismissPanels() {
    setLeftPanel(null);
    if (surface !== "compact") return;
    setInspector(null);
    setSettingsOpen(false);
    setLayersOpen(false);
  }

  /** Eat the one click a finished drag leaves behind. Self-removing on the
   *  first click, with a timeout in case none arrives at all: a gesture that
   *  ended outside any clickable element produces no click, and a listener left
   *  armed would eat the seller's next real tap. */
  function swallowNextClick() {
    function eat(event: MouseEvent) {
      event.preventDefault();
      event.stopPropagation();
      done();
    }
    function done() {
      window.clearTimeout(timer);
      window.removeEventListener("click", eat, true);
    }
    const timer = window.setTimeout(done, 400);
    window.addEventListener("click", eat, true);
  }

  // Place the board sensibly on first paint: centred, or scaled down first
  // when it is wider than the window. Runs once — after that the view is the
  // seller's to move. Waits for the canvas to actually exist, which on a
  // fresh mobile-preview load with no page open yet is never — that is fine,
  // the effect just fires (once) whenever a page later brings the canvas up.
  const placedInitialView = useRef(false);
  useEffect(() => {
    if (placedInitialView.current || !designView) return;
    let frame = 0;
    // The stage may not have laid out on the very first tick.
    function place(attempt: number) {
      const view = measureView();
      const room = safeWindow();
      if (!view || !room) {
        if (attempt < 5) frame = requestAnimationFrame(() => place(attempt + 1));
        return;
      }
      placedInitialView.current = true;
      if (view.width + CANVAS_MARGIN * 2 > room.width) fitOnFirstPaint();
      else centerCanvas(1);
    }
    place(0);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot placement
  }, [designView]);

  function togglePicker() {
    setInspector((current) =>
      current?.kind === "picker" ? null : { kind: "picker" },
    );
    setSettingsOpen(false);
    // Choosing a product is a different job from choosing a colour, and on a
    // phone they are the same bottom slot — leaving the colour sheet up would
    // hide the picker behind it.
    setColorTarget(null);
    // Same again for the stack, which takes the whole panel body: the picker
    // would open behind it and the button would look dead.
    setLayersOpen(false);
  }

  function toggleSettings() {
    const next = !settingsOpen;
    setSettingsOpen(next);
    // On mobile all three are the same bottom slot, so opening this one has to
    // clear the others.
    if (next) {
      setInspector(null);
      setColorTarget(null);
      setLayersOpen(false);
    }
  }

  /** The blocks as the grid's placement helpers want them. Tilt included, so
   *  the search for somewhere free measures a turned block by the cells it
   *  PAINTS on rather than the ones it is placed in. */
  function canvasBlocks() {
    return blocks.map((block) => ({
      key: blockKey(block),
      x: block.x,
      y: block.y,
      w: block.w,
      h: block.h,
      rotation: block.rotation,
      data: null,
    }));
  }

  /**
   * Where a new w x h block should land: the cell the seller pointed at when
   * it is free, otherwise the first free spot, otherwise a freshly grown row,
   * otherwise ON TOP of what is already there.
   *
   * Never null. Empty space is a PREFERENCE, not a requirement: blocks may be
   * stacked, so a board with no room left is not a board that can refuse a
   * block. The seller asked for it; the worst case is that it arrives on top
   * of something and they move it or send it back.
   */
  function findSpot(
    w: number,
    h: number,
    at?: { x: number; y: number },
  ): BlockPlacement & { growRows?: number } {
    const existing = canvasBlocks();
    const { columns, rows } = theme;
    if (
      at &&
      placementIsFree(existing, { ...at, w, h }, null, columns, rows)
    ) {
      return { ...at, w, h };
    }
    const free = findFreeCell(existing, w, h, columns, rows);
    if (free) return { ...free, w, h };

    // Nothing free: grow the board first, since a new row is a tidier answer
    // than a stack the seller did not ask for.
    const grown = Math.min(CANVAS_ROWS_MAX, rows + h);
    if (grown > rows) {
      const spot = findFreeCell(existing, w, h, columns, grown);
      if (spot) return { ...spot, w, h, growRows: grown };
    }
    // Full board at its maximum height. Land on the pointed cell, or the top
    // left, and let paint order sort it out.
    return clampToCanvas({ ...(at ?? { x: 0, y: 0 }), w, h }, columns, rows);
  }

  /**
   * Commit a new block at a found spot, growing the canvas if that's what the
   * spot needed.
   *
   * The block cap is the ONLY reason this can now come back empty: findSpot
   * always has an answer, so "there is no room" has stopped being a way to
   * fail. The callers that report it to the seller keep doing so.
   */
  function insertBlock(
    build: (placement: BlockPlacement) => StorefrontBlock,
    w: number,
    h: number,
    at?: { x: number; y: number },
  ): StorefrontBlock | null {
    if (blocks.length >= MAX_BLOCKS) return null;
    const spot = findSpot(w, h, at);
    recordChange();
    if (spot.growRows) setTheme({ ...theme, rows: spot.growRows });
    const block = build({ x: spot.x, y: spot.y, w: spot.w, h: spot.h });
    setBlocks((current) => [...current, block]);
    return block;
  }

  function addProduct(productId: string) {
    if (usedProductIds.has(productId)) return;
    insertBlock(
      (placement) => ({ type: "product", productId, ...placement }),
      1,
      1,
      takeInsertHint(),
    );
    // The picker stays open so several products can be added in one pass.
  }

  function addTextBlock() {
    const block = insertBlock(
      (placement) => ({
        type: "text",
        id: crypto.randomUUID(),
        text: "Your text here",
        variant: "heading",
        align: "left",
        ...placement,
      }),
      Math.min(2, theme.columns),
      1,
      takeInsertHint(),
    );
    if (!block) return;
    selectBlock(blockKey(block), false, block);
    // Straight into typing, with the placeholder selected: "add text" means
    // the seller has words in mind, and the first keystroke should be them.
    beginTyping(blockKey(block), true);
  }

  function addShapeBlock(kind: ShapeKind) {
    const block = insertBlock(
      (placement) => ({
        type: "shape",
        id: crypto.randomUUID(),
        kind,
        // Accent is the natural starting fill.
        color: theme.accent,
        ...placement,
      }),
      1,
      1,
      takeInsertHint(),
    );
    if (block) selectBlock(blockKey(block), false, block);
  }

  /**
   * Upload the seller's own artwork and drop it on the canvas.
   *
   * Upload FIRST, insert second. The block stores an object key, so a block
   * inserted before the upload finished would be one the schema rejects — and
   * a failed upload would leave a permanent hole on the canvas that undo, not
   * the seller, has to clean up. Nothing is recorded in history until there is
   * a real key to record.
   *
   * The preview URL is the local file, not a signed one: the object exists in
   * R2 by now, but signing is server-side, so the freshly-added element shows
   * from the seller's own copy until the next page load hands down a real URL.
   */
  async function addImageBlock(file: File) {
    if (blocks.length >= MAX_BLOCKS) {
      toast.error("This storefront is full.", {
        lines: [`A storefront can hold up to ${MAX_BLOCKS} blocks.`],
      });
      return;
    }

    let key: string;
    setUploadingElement(true);
    setUploadProgress(0);
    try {
      key = await uploadToR2(file, "element", setUploadProgress);
    } catch (error) {
      if (error instanceof UploadError) {
        toast.error(error.info.message, { lines: [error.info.fix] });
      } else {
        toast.error("That image could not be uploaded.", {
          lines: ["Try again in a moment."],
        });
      }
      return;
    } finally {
      setUploadingElement(false);
      setUploadProgress(0);
    }

    // The preview URL is the seller's own copy of the file. The object is in
    // R2 by now, but signing is server-side, so this stands in until the next
    // page load hands down a real signed URL.
    placeImageBlock(key, "", URL.createObjectURL(file));
  }

  /**
   * Put a block on the canvas for artwork that is ALREADY uploaded.
   *
   * Shared by a fresh upload and the library's "place it again", because they
   * differ only in where the key came from. Re-placing costs no upload and no
   * extra bytes for the buyer: two blocks holding one key are two views of one
   * stored object, and saveStorefront's eviction only drops a key nothing
   * references any more.
   */
  function placeImageBlock(key: string, alt: string, previewUrl?: string) {
    const block = insertBlock(
      (placement) => ({
        type: "image",
        id: crypto.randomUUID(),
        key,
        // Empty alt marks decorative artwork, which is what an element is
        // until the seller says otherwise in the inspector.
        alt,
        ...placement,
      }),
      1,
      1,
      takeInsertHint(),
    );
    if (!block) return;

    if (previewUrl) {
      setElementUrls((current) => ({
        ...current,
        [blockKey(block)]: previewUrl,
      }));
    }
    selectBlock(blockKey(block), false, block);
  }

  /** Place another copy of artwork already in this storefront. */
  function placeUpload(upload: StorefrontUpload) {
    placeImageBlock(upload.key, upload.alt, upload.url ?? undefined);
  }

  /** Remove several blocks in ONE undo step; the selection keeps whatever
   *  survives. Single removals go through here too. */
  function removeBlocks(keys: readonly string[]) {
    if (keys.length === 0) return;
    const gone = new Set(keys);
    recordChange();
    setBlocks((current) => current.filter((b) => !gone.has(blockKey(b))));
    setInspector((current) => {
      if (current?.kind !== "blocks") return current;
      const left = current.keys.filter((k) => !gone.has(k));
      return left.length > 0 ? { kind: "blocks", keys: left } : null;
    });
  }

  function removeBlock(key: string) {
    removeBlocks([key]);
  }

  // COPY / PASTE, for text and shape blocks. Editor-internal (a ref, not the
  // system clipboard): the payload is live config blocks, and pasting mints
  // fresh ids, so nothing round-trips through serialized text. Product
  // blocks are deliberately excluded — a product tile IS its product (one
  // block per product, keyed by productId), so there is nothing valid a
  // pasted copy could be.
  const clipboard = useRef<(TextBlock | ShapeBlock | ImageBlock)[]>([]);

  /**
   * Insert copies of text/shape blocks with fresh ids, as ONE undo step, and
   * select them. Each copy prefers the clicked cell (first copy only), then
   * the spot just right of its source, then the first free cell, growing the
   * board when full. Placement runs against a WORKING occupancy list, so
   * pasting several blocks in one go can never stack copies on one cell.
   */
  function pasteBlocks(sources: readonly (TextBlock | ShapeBlock | ImageBlock)[]) {
    if (sources.length === 0) return;
    const working = canvasBlocks();
    const { columns } = theme;
    let rows = theme.rows;
    const hint = takeInsertHint();
    const added: StorefrontBlock[] = [];

    for (const source of sources) {
      if (blocks.length + added.length >= MAX_BLOCKS) break;
      const { w, h } = source;
      const preferred = added.length === 0 && hint
        ? hint
        : { x: source.x + source.w, y: source.y };
      let spot: BlockPlacement | null = placementIsFree(
        working,
        { ...preferred, w, h },
        null,
        columns,
        rows,
      )
        ? { ...preferred, w, h }
        : null;
      if (!spot) {
        const free = findFreeCell(working, w, h, columns, rows);
        if (free) spot = { ...free, w, h };
      }
      if (!spot) {
        const grown = Math.min(CANVAS_ROWS_MAX, rows + h);
        if (grown > rows) {
          const free = findFreeCell(working, w, h, columns, grown);
          if (free) {
            spot = { ...free, w, h };
            rows = grown;
          }
        }
      }
      // Nowhere free on a full board at its full height: the copy lands on
      // top of its source rather than being dropped on the floor. Paste is a
      // deliberate act and has to produce something every time.
      if (!spot) {
        spot = clampToCanvas({ x: source.x, y: source.y, w, h }, columns, rows);
      }
      // Placement field by field rather than spread: the copy keeps the
      // source's tilt and depth, and a spot that ever carried either of them
      // would silently overwrite the copy's.
      const copy: StorefrontBlock = {
        ...structuredClone(source),
        id: crypto.randomUUID(),
        x: spot.x,
        y: spot.y,
        w: spot.w,
        h: spot.h,
      };
      added.push(copy);
      working.push({
        key: blockKey(copy),
        x: copy.x,
        y: copy.y,
        w: copy.w,
        h: copy.h,
        // A copy of a turned block occupies its turned footprint, so the next
        // copy in the same paste looks for room around the right shape.
        rotation: copy.rotation,
        data: null,
      });
    }

    if (added.length === 0) return;
    recordChange();
    if (rows !== theme.rows) setTheme({ ...theme, rows });
    setBlocks((current) => [...current, ...added]);
    setInspector({ kind: "blocks", keys: added.map(blockKey) });
    setSettingsOpen(false);

    // A copied element points at the SAME stored object as its source, so the
    // copy reuses the source's display URL. Without this the duplicate renders
    // its placeholder until the page is loaded again, which reads as a broken
    // paste rather than a working one.
    const copiedUrls = added.flatMap((copy, index) => {
      const source = sources[index];
      if (copy.type !== "image" || source === undefined) return [];
      const url = elementUrls[blockKey(source)];
      return url ? [[blockKey(copy), url] as const] : [];
    });
    if (copiedUrls.length > 0) {
      setElementUrls((current) => ({
        ...current,
        ...Object.fromEntries(copiedUrls),
      }));
    }
  }

  /** Copy the selection's text/shape blocks into the editor clipboard. */
  function copySelectedBlocks() {
    const copyable = selectedBlocks.filter(
      (b): b is TextBlock | ShapeBlock | ImageBlock => b.type !== "product",
    );
    if (copyable.length === 0) return;
    clipboard.current = structuredClone(copyable);
    toast.success(
      copyable.length === 1
        ? "Block copied."
        : `${copyable.length} blocks copied.`,
      { lines: ["Paste with Ctrl+V or Cmd+V."] },
    );
  }

  function pasteClipboard() {
    pasteBlocks(clipboard.current);
  }

  /** Copy + paste in one step, for the inspector's Duplicate button (the
   *  no-keyboard path). Also fills the clipboard, so Ctrl+V repeats it. */
  function duplicateBlocks(keys: readonly string[]) {
    const wanted = new Set(keys);
    const sources = blocks.filter(
      (b): b is TextBlock | ShapeBlock | ImageBlock =>
        wanted.has(blockKey(b)) && b.type !== "product",
    );
    if (sources.length === 0) return;
    clipboard.current = structuredClone(sources);
    pasteBlocks(sources);
  }

  // Ctrl/Cmd+C / V. Same subscribe-once + ref shape as the undo listener, and
  // the same guards: never while typing (fields keep native copy/paste), and
  // copy also yields whenever real text is selected on the page, so copying
  // prose from the inspector never turns into copying the tile behind it.
  const clipboardActions = useRef({ copySelectedBlocks, pasteClipboard });
  useEffect(() => {
    clipboardActions.current = { copySelectedBlocks, pasteClipboard };
  });
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key !== "c" && key !== "v") return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (key === "c") {
        if (window.getSelection()?.toString()) return;
        clipboardActions.current.copySelectedBlocks();
      } else {
        clipboardActions.current.pasteClipboard();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function moveBlock(key: string, x: number, y: number) {
    recordChange(`move:${key}`);
    setBlocks((current) =>
      current.map((b) => (blockKey(b) === key ? { ...b, x, y } : b)),
    );
  }

  /** Takes the whole placement: stretching a tile up or left moves its origin
   *  as well as its span, so x/y have to travel with w/h. */
  function resizeBlock(key: string, placement: BlockPlacement) {
    recordChange(`size:${key}`);
    setBlocks((current) =>
      current.map((b) => (blockKey(b) === key ? { ...b, ...placement } : b)),
    );
  }

  /**
   * Tilt every block in `keys`, as ONE undo step.
   *
   * Each block turns about its OWN centre rather than the selection's, which
   * keeps the operation independent of how the blocks happen to be arranged.
   * Turning a group as a rigid body needs sub-cell coordinates to land on, so
   * it belongs with free placement rather than here.
   *
   * withRotation is the writer, so levelling a block drops the field instead
   * of storing a zero, and a drag that ends where it started returns the same
   * block objects and never marks the editor dirty.
   *
   * Nothing else changes: not x, not y, not w, not h. A turned block covers
   * the same cells the other way round (see blockFootprint), so there is
   * nothing to make room for, and if its corners now reach past the board's
   * edge that is a thing the seller can see and drag back. Moving the block
   * for them would make a rotate control that also repositions, which is
   * exactly the surprise it must not be.
   */
  function rotateBlocks(keys: readonly string[], degrees: number) {
    const targets = new Set(keys);
    // Coalesced on the SELECTION, so a slider drag or a spin of the handle is
    // one entry, and rotating a different block afterwards is its own.
    recordChange(`rotate:${[...targets].sort().join(",")}`);
    setBlocks((current) =>
      current.map((b) =>
        targets.has(blockKey(b)) ? withRotation(b, degrees) : b,
      ),
    );
  }

  /**
   * Move the selection through the board's paint order.
   *
   * The layers module owns the rules (dense z, the selection travelling as a
   * run) and answers a no-op by handing back the SAME array, which is what
   * lets a press at the end of the stack cost nothing at all: no history
   * entry, no dirty flag, no re-render.
   *
   * No coalesce key, unlike a slider drag: two presses of "bring forward" are
   * two separate intentions, and undo has to walk back through them one at a
   * time.
   */
  function reorderLayers(keys: readonly string[], op: LayerOp) {
    const next = LAYER_OPS[op](blocks, keys);
    if (next === blocks) return;
    recordChange();
    setBlocks(next);
  }

  /**
   * Drop one block at an explicit depth — the layers list's drag, which lands
   * where it was let go rather than one step per press.
   *
   * One undo step per DROP, not per row crossed: a drag is a single intention
   * however far it travelled, and the same no-op bail as above means a row
   * dropped back where it started costs nothing.
   */
  function moveLayer(key: string, index: number) {
    const next = moveLayerTo(blocks, [key], index);
    if (next === blocks) return;
    recordChange();
    setBlocks(next);
  }

  /**
   * Selecting from the layers list.
   *
   * Deliberately NOT selectBlock: that one opens the colour panel on the
   * block's leading colour, which on a phone is a second bottom sheet landing
   * over the very list being picked from — and on desktop swaps the left
   * column on every row you touch. This is the marquee's channel instead
   * (see selectMany), which leaves the colour panel alone.
   *
   * A plain press always SELECTS rather than toggling: on the canvas, clicking
   * the one selected block again deselects it, because there the click also
   * means "nothing here". In a list a row is only ever the block it names.
   */
  /**
   * Act on a row from the design panel's search field.
   *
   * Settings never reach here (ControlsPanel opens those itself, through the
   * same opener universal search uses). What is left is everything the field
   * can find that only the editor knows how to reach: an object on the board,
   * and the drawers. Each case is the SAME call the toolbar or the layers list
   * already makes, so a search hit and a click land in identical state.
   */
  function jumpTo(target: EditorJump) {
    if (target.kind === "block") {
      selectFromLayers(target.key, false);
      return;
    }
    switch (target.panel) {
      case "layers":
        setLayersOpen(true);
        break;
      case "products":
        // Not `togglePicker`: a search hit is a request to OPEN, and toggling
        // would close the picker for anyone who searched while it was up.
        setInspector({ kind: "picker" });
        setSettingsOpen(false);
        setColorTarget(null);
        setLayersOpen(false);
        break;
      case "shapes":
      case "uploads":
        setLeftPanel({ kind: "library", tab: target.panel });
        break;
    }
  }

  function selectFromLayers(key: string, additive: boolean) {
    if (!additive) {
      selectMany([key]);
      return;
    }
    setInspector((current) => {
      const keys = current?.kind === "blocks" ? current.keys : [];
      const next = keys.includes(key)
        ? keys.filter((k) => k !== key)
        : [...keys, key];
      return next.length > 0 ? { kind: "blocks", keys: next } : null;
    });
  }

  /**
   * Pack every block toward the top-left in reading order — the old auto-flow
   * layout, available on demand for sellers who don't want to place things by
   * hand.
   *
   * The one control that deliberately UNDOES a stack: tidy means "lay this out
   * as a grid", and a grid has one thing per cell. Blocks are packed by their
   * FOOTPRINT so a tilted block is given room for the cells it really covers,
   * then centred in the space it was given, which keeps its angle without
   * letting it cross into its neighbour.
   */
  function tidyBlocks() {
    recordChange();
    setBlocks((current) => {
      const ordered = readingOrder(current);
      const packed = packFirstFit(
        ordered.map((block) => {
          const covered = blockFootprint(block);
          return { w: covered.w, h: covered.h };
        }),
        theme.columns,
      );
      return ordered.map((block, index) => {
        const covered = blockFootprint(block);
        const spot = packed[index];
        // The block sits in the middle of the room its footprint asked for,
        // so a tilted block's corners land inside that room rather than the
        // block's own rect landing on the corner of it.
        return {
          ...block,
          x: spot.x + Math.round((covered.w - block.w) / 2),
          y: spot.y + Math.round((covered.h - block.h) / 2),
        };
      });
    });
  }

  /**
   * Resize the canvas itself. Shrinking never cuts a block off: the minimum is
   * whatever the content PAINTS out to, tilted corners included.
   *
   * Capped at the schema's own maximums, which a footprint can exceed where a
   * placement cannot: a block turned at the far edge paints past it by design,
   * and letting that push the board to 13 columns would produce a canvas the
   * seller could no longer save.
   */
  function updateCanvas(columns: number, rows: number) {
    const minColumns = blocks.reduce((max, block) => {
      const covered = blockFootprint(block);
      return Math.max(max, covered.x + covered.w);
    }, CANVAS_COLUMNS_MIN);
    const minRows = blocks.reduce((max, block) => {
      const covered = blockFootprint(block);
      return Math.max(max, covered.y + covered.h);
    }, CANVAS_ROWS_MIN);
    updateTheme({
      ...theme,
      columns: Math.min(CANVAS_COLUMNS_MAX, Math.max(columns, minColumns)),
      rows: Math.min(CANVAS_ROWS_MAX, Math.max(rows, minRows)),
    });
  }

  // The block update functions all take a KEY LIST: the single-block editors
  // pass one key, the group editor passes the whole selection, and either way
  // the edit is one undo step. Keys of the wrong block type are ignored, so a
  // mixed selection can safely be handed to any of them.

  /**
   * Merge a card-style patch into product blocks' overrides. Overrides store
   * ONLY what differs from following the theme, so an override object that
   * empties out is dropped entirely and the block goes back to being
   * indistinguishable from one that was never customized (the merge
   * semantics live in mergeCardStyleOverrides).
   */
  function updateProductBlocksStyle(
    keys: readonly string[],
    patch: CardStyleOverrides,
  ) {
    const wanted = new Set(keys);
    // Coalesce per field, so a slider scrub is one undo step but edits to
    // different controls stay separate steps.
    recordChange(`pstyle:${keys.join("+")}:${Object.keys(patch)[0] ?? ""}`);
    setBlocks((current) =>
      current.map((b) => {
        if (b.type !== "product" || !wanted.has(blockKey(b))) return b;
        const style = mergeCardStyleOverrides(b.style, patch);
        if (style === undefined) {
          const rest = { ...b };
          delete rest.style;
          return rest;
        }
        return { ...b, style };
      }),
    );
  }

  /**
   * The title or the price, dropped somewhere new on its own tile.
   *
   * Writes through the SAME per-tile override mutator the panel's controls use,
   * so a drag and a click on the board produce the same document, land in the
   * same undo step (the coalesce key is per field, and a whole drag only ever
   * touches one), and behave identically on a tile that was following the theme
   * until now.
   */
  function placeTileSpot(key: string, token: SpotToken, drop: SpotDrop) {
    updateProductBlocksStyle(
      [key],
      token === "title"
        ? { titlePosition: drop === "below" ? undefined : drop }
        : { priceTagPosition: drop },
    );
  }

  /**
   * PRESSING A LABEL ON A TILE OPENS THE CONTROLS THAT SHAPE IT.
   *
   * The same bargain the product page artboard already makes (see
   * PRODUCT_PAGE_HOTSPOTS): what a seller can see, they can point at, and the
   * shortest route from "this price is wrong" to the panel that fixes it is
   * the price itself. Dragging a label moves it; pressing it opens what it
   * looks like.
   *
   * The tile is asserted as the selection rather than assumed. A token is only
   * armed on a sole selection, so this is normally a no-op — but openSetting
   * decides between the tile's inspector and the storefront's panel by reading
   * that selection, and it would read a stale one inside the very event that
   * changed it.
   */
  function openTileLabelSetting(key: string, token: SpotToken) {
    setInspector({ kind: "blocks", keys: [key] });
    setSettingTarget(
      freshSettingRef({
        kind: "cards",
        section: token === "price" ? "priceTag" : "cardStyle",
      }),
    );
    setSettingsOpen(false);
    setPanelOpen(true);
  }

  /**
   * FRAME MODE: positioning one product's photo inside its own tile.
   *
   * Held apart from the inspector selection because they answer different
   * questions — which block's settings are open, versus which block's picture
   * the pointer is currently moving. The ref mirrors it so the document-level
   * shortcut listeners (delete, and selection changes) can read it without
   * re-subscribing on every entry and exit.
   */
  const [framingKey, setFramingKey] = useState<string | null>(null);
  const framingKeyRef = useRef<string | null>(null);

  /**
   * Enter frame mode on a tile, and make sure it is the selected one.
   *
   * The selection matters because a double-click fires TWO clicks first, which
   * the tile's own handler would have toggled through select-then-deselect.
   * The tile suppresses the second (detail > 1), so this only has to assert
   * the end state rather than unpick the sequence.
   */
  function frameBlock(key: string) {
    setInspector({ kind: "blocks", keys: [key] });
    setSettingsOpen(false);
    // The two in-place modes are exclusive: a picture cannot be framed while
    // words are being typed somewhere else on the board.
    if (typingRef.current !== null) endTyping();
    setFramingKey(key);
    framingKeyRef.current = key;
  }

  function exitFrameMode() {
    setFramingKey(null);
    framingKeyRef.current = null;
  }

  function beginTyping(key: string, selectAll = false) {
    // The tile taking the keystrokes is the one whose settings are open.
    setInspector({ kind: "blocks", keys: [key] });
    setSettingsOpen(false);
    exitFrameMode();
    setTyping({ key, selectAll });
    typingRef.current = key;
  }

  function endTyping() {
    setTyping(null);
    typingRef.current = null;
    setTypingRange(null);
  }

  /** A block that stops existing (deleted, or undone away) takes typing mode
   *  with it, rather than leaving the canvas typing into nothing. */
  useEffect(() => {
    if (typing === null) return;
    if (!blocks.some((b) => blockKey(b) === typing.key)) endTyping();
  }, [blocks, typing]);

  /** One keystroke on the tile, or one in-place format. Text and spans travel
   *  together, and coalesce into a single undo step per block exactly as the
   *  panel's field used to. */
  function setBlockText(
    key: string,
    text: string,
    spans: TextSpan[],
    source: TextEditSource,
  ) {
    updateTextBlocks(
      [key],
      {
        text,
        // Absent rather than empty, so a block nobody has part-formatted stays
        // byte-identical to one saved before spans existed.
        spans: spans.length > 0 ? spans : undefined,
      },
      source,
    );
  }

  /**
   * Ctrl+B / I / U with nothing selected: the whole block. The flag is flipped
   * AND every range that overrode it is dropped, because "no selection" means
   * the command was about all of the text — leaving a span behind would make
   * the shortcut look broken on the words it had already coloured.
   */
  function toggleBlockFormat(key: string, format: InlineFormatKey) {
    toggleBlocksFormat([key], format);
  }

  /**
   * The same thing for a whole selection, which is what the canvas shortcut
   * sends. Each block flips its OWN flag rather than being forced to a shared
   * value: bolding a mixed selection should leave every block bold-toggled the
   * way its own Format button would.
   */
  function toggleBlocksFormat(
    keys: readonly string[],
    format: InlineFormatKey,
  ) {
    const wanted = new Set(keys);
    if (!blocks.some((b) => b.type === "text" && wanted.has(blockKey(b)))) return;
    recordChange();
    setBlocks((current) =>
      current.map((b) => {
        if (b.type !== "text" || !wanted.has(blockKey(b))) return b;
        const spans = applyFormatToRange(
          b.spans,
          b.text.length,
          { start: 0, end: b.text.length },
          { [format]: null },
        );
        const next = { ...b, [format]: !b[format] };
        if (spans.length > 0) next.spans = spans;
        else delete next.spans;
        return next;
      }),
    );
  }

  /** A block that stops existing (deleted, undone away, or replaced by a
   *  fresh load) takes frame mode with it, rather than leaving the canvas in
   *  a mode pinned to a key nothing answers to. */
  useEffect(() => {
    if (framingKey === null) return;
    if (!blocks.some((b) => blockKey(b) === framingKey)) exitFrameMode();
  }, [blocks, framingKey]);

  function updateImagePlacement(key: string, placement: ImagePlacement) {
    // One undo step per gesture, like a block drag: the coalesce key holds
    // the whole drag together, and lifting the pointer for longer than the
    // window starts a new one.
    recordChange(`frame:${key}`);
    setBlocks((current) =>
      current.map((b) => {
        // Product photos and uploaded elements share the placement model, so
        // they share this mutator — the framer never needed to know which.
        if ((b.type !== "product" && b.type !== "image") || blockKey(b) !== key) {
          return b;
        }
        // Framing that lands back on centred-and-unzoomed drops the field, so
        // a tile the seller reset is byte-identical to one never touched.
        if (isDefaultPlacement(placement)) {
          if (b.imagePlacement === undefined) return b;
          const rest = { ...b };
          delete rest.imagePlacement;
          return rest;
        }
        return { ...b, imagePlacement: placement };
      }),
    );
  }

  /**
   * Patch the selected image blocks. Coalesced per field so dragging the
   * opacity slider is one undo step rather than twenty, exactly like the
   * shape and text editors.
   */
  function updateImageBlocks(
    keys: readonly string[],
    patch: Partial<Pick<ImageBlock, "alt" | "fit" | "opacity">>,
    coalesceKey?: string,
  ) {
    const wanted = new Set(keys);
    recordChange(coalesceKey);
    setBlocks((current) =>
      current.map((b) =>
        b.type === "image" && wanted.has(blockKey(b)) ? { ...b, ...patch } : b,
      ),
    );
  }

  /** Drop product blocks' overrides so they follow the theme again. */
  function resetProductBlocksStyle(keys: readonly string[]) {
    const wanted = new Set(keys);
    recordChange();
    setBlocks((current) =>
      current.map((b) => {
        if (b.type !== "product" || !wanted.has(blockKey(b)) || !b.style) {
          return b;
        }
        const rest = { ...b };
        delete rest.style;
        return rest;
      }),
    );
  }

  /**
   * `coalesce` names what KIND of change this is, and so which run of changes
   * collapses into one undo step. A burst of keystrokes is one step; the bold
   * applied after it is another, and the colour after that a third. Without
   * the split, one Ctrl+Z would take back a format AND the sentence it was
   * applied to.
   */
  function updateTextBlocks(
    keys: readonly string[],
    patch: TextBlockPatch,
    coalesce = "text",
  ) {
    const wanted = new Set(keys);
    recordChange(`${coalesce}:${keys.join("+")}`);
    setBlocks((current) =>
      current.map((b) =>
        b.type === "text" && wanted.has(blockKey(b)) ? { ...b, ...patch } : b,
      ),
    );
  }

  /**
   * A colour for a text block. Onto the SELECTED WORDS when part of the text is
   * selected in the in-place editor, onto the whole block otherwise — which is
   * the one rule behind both the inspector's picker and the left-hand panel.
   * `undefined` clears: back to the block for a range, back to the theme for
   * the block itself.
   */
  function setTextColor(key: string, hex: string | undefined) {
    const target = textRangeTarget;
    if (!target || blockKey(target.block) !== key) {
      updateTextBlocks([key], { color: hex });
      return;
    }
    const spans = applyFormatToRange(
      target.block.spans,
      target.block.text.length,
      target.range,
      { color: hex ?? null },
    );
    updateTextBlocks(
      [key],
      { spans: spans.length > 0 ? spans : undefined },
      // Its own undo step, and one that still coalesces while a colour is
      // being dragged around the wheel.
      "color",
    );
  }

  function updateShapeBlocks(keys: readonly string[], patch: ShapeBlockPatch) {
    const wanted = new Set(keys);
    recordChange(`shape:${keys.join("+")}`);
    setBlocks((current) =>
      current.map((b) =>
        b.type === "shape" && wanted.has(blockKey(b)) ? { ...b, ...patch } : b,
      ),
    );
  }

  /**
   * Turn a color-panel pick back into a mutation. The ONE place a ColorTargetRef
   * becomes a change, and it deliberately goes through the same mutators the
   * inline editors use — so a color set from the left panel lands in undo
   * history and flips the dirty flag exactly like one set from a swatch.
   */
  function applyColorTarget(ref: ColorTargetRef, hex: string) {
    switch (ref.kind) {
      case "theme-accent":
        updateTheme({ ...theme, accent: hex });
        return;
      case "theme-background-solid":
        if (theme.background.kind !== "solid") return;
        updateTheme({ ...theme, background: { kind: "solid", color: hex } });
        return;
      case "theme-background-from":
        if (theme.background.kind !== "gradient") return;
        updateTheme({ ...theme, background: { ...theme.background, from: hex } });
        return;
      case "theme-background-to":
        if (theme.background.kind !== "gradient") return;
        updateTheme({ ...theme, background: { ...theme.background, to: hex } });
        return;
      case "header-name":
        updateHeaderStyle("name", "color", hex);
        return;
      case "header-bio":
        updateHeaderStyle("bio", "color", hex);
        return;
      case "shape-fill":
        updateShapeBlocks([ref.blockKey], { color: hex });
        return;
      case "shape-border":
        updateShapeBlocks([ref.blockKey], { borderColor: hex });
        return;
      case "text-color":
        setTextColor(ref.blockKey, hex);
        return;
      case "price-tag":
        setPriceTagColor(ref, hex);
        return;
    }
  }

  /**
   * Write (or clear) one of the price tag's three colors. The one ref that
   * spans both scopes: with a blockKey it is that tile's override, without one
   * the theme's default for every tile.
   */
  function setPriceTagColor(
    ref: Extract<ColorTargetRef, { kind: "price-tag" }>,
    hex: string | undefined,
  ) {
    const patch = { [PRICE_TAG_COLOR_KEYS[ref.part]]: hex };
    if (ref.blockKey) {
      updateProductBlocksStyle([ref.blockKey], patch);
      return;
    }
    // Drop the key rather than storing undefined, so a theme whose color was
    // set and cleared is identical to one that never had it.
    const next: Record<string, unknown> = { ...theme, ...patch };
    if (hex === undefined) delete next[PRICE_TAG_COLOR_KEYS[ref.part]];
    updateTheme(next as StorefrontTheme);
  }

  /**
   * The masthead's lines have no tile and no inspector card, so the panel that
   * edits their color is also where their SIZE is set. Every other target
   * hands the panel colors alone and it renders as it always did.
   */
  function headerTypography(ref: ColorTargetRef): PanelTypography | undefined {
    const line = headerLineOf(ref);
    if (!line) return undefined;
    const read = <F extends HeaderStyleField>(field: F) =>
      headerStyleValue(header, line, field);
    return {
      size: read("size"),
      autoSize: HEADER_BASE_PX[line],
      onSizeChange: (size) => updateHeaderStyle(line, "size", size),
      font: read("font"),
      hasCustomFont: theme.customFont !== undefined,
      onFontChange: (font) => updateHeaderStyle(line, "font", font),
      bold: read("bold") === true,
      italic: read("italic") === true,
      underline: read("underline") === true,
      onFormatToggle: (key) => toggleHeaderFormat(line, key),
      align: read("align") ?? "left",
      onAlignChange: (align) =>
        // Left is what the masthead renders with no alignment at all, so
        // choosing it clears the override instead of storing the default.
        updateHeaderStyle(line, "align", align === "left" ? undefined : align),
    };
  }

  /** Which masthead line a colour target names, if any. */
  function headerLineOf(ref: ColorTargetRef | null): HeaderLine | null {
    if (ref?.kind === "header-name") return "name";
    if (ref?.kind === "header-bio") return "bio";
    return null;
  }

  /** Write one masthead line's styling. The drop-the-key semantics live in
   *  setHeaderStyle, so every path here shares them. */
  function updateHeaderStyle<F extends HeaderStyleField>(
    line: HeaderLine,
    field: F,
    value: HeaderStyleValue[F] | undefined,
  ) {
    updateHeader(setHeaderStyle(header, line, field, value));
  }

  /** Flip one of a line's formatting toggles, dropping the key on the way back
   *  off so an unstyled masthead stays unstyled in storage. */
  function toggleHeaderFormat(
    line: HeaderLine,
    field: "bold" | "italic" | "underline",
  ) {
    const next = headerStyleValue(header, line, field) !== true;
    updateHeaderStyle(line, field, next ? true : undefined);
  }

  /** Clear an optional color override, sending the field back to the theme.
   *  The header's two lines DROP their key rather than storing `undefined`, so
   *  a header the seller never colored stays identical to a legacy one. */
  function clearColorTarget(ref: ColorTargetRef) {
    if (ref.kind === "text-color") {
      setTextColor(ref.blockKey, undefined);
      return;
    }
    if (ref.kind === "price-tag") {
      setPriceTagColor(ref, undefined);
      return;
    }
    if (ref.kind === "header-name" || ref.kind === "header-bio") {
      updateHeaderStyle(ref.kind === "header-name" ? "name" : "bio", "color", undefined);
    }
  }

  /**
   * Open the panel on a field. Also closes the mobile sheets, because on a
   * phone all three are the same bottom slot and only one can own it — the same
   * rule the inspector and the settings sheet already apply to each other.
   */
  function openColorTarget(ref: ColorTargetRef) {
    setColorTarget(ref);
    setSettingsOpen(false);
  }

  /**
   * The selection toolbar asking for one control of the selected block's
   * inspector: open the panel and mark the field (see SummonedField).
   *
   * A fresh nonce every time, so pressing the same button twice flashes the
   * same field twice. The request is an instruction, not a mode — nothing
   * clears it, because nothing needs to: the mark fades on its own and the
   * next press mints a new one.
   */
  function openBlockField(field: BlockField) {
    setBlockField({ field, nonce: blockFieldNonce.current++ });
    setPanelOpen(true);
    // On a phone all three panels share one bottom slot, and only one can own
    // it — the same rule openColorTarget applies just above.
    setSettingsOpen(false);
  }

  /**
   * OPENING A SETTING BY NAME, from universal search or the panel's own filter.
   *
   * The ref only says WHICH setting. Which of its two copies to show is decided
   * here, against the live selection, because that is the only place that knows
   * it: a per-tile setting with a product tile selected means the seller is
   * asking about THAT tile, and the same words with nothing selected mean the
   * storefront. A non-product tile has no card style at all, so it falls back
   * to the storefront's copy rather than opening an inspector that cannot
   * answer.
   *
   * The ref is cleared shortly after. It is an instruction, not a mode: leaving
   * it set would re-open the group every time the panel re-rendered, and would
   * fight the seller the moment they navigated somewhere else.
   */
  const [settingTarget, setSettingTarget] = useState<SettingRef | null>(
    // A cold arrival from a search result picked elsewhere. Seeded rather than
    // opened in an effect, so the panel is already on the right group when the
    // editor first paints.
    () => settingById(initialSetting ?? "")?.ref ?? null,
  );
  useEffect(() => {
    if (!settingTarget) return;
    const timer = setTimeout(() => setSettingTarget(null), 1200);
    return () => clearTimeout(timer);
  }, [settingTarget]);

  function openSetting(ref: SettingRef) {
    // A product page setting is edited while LOOKING at the page, so opening
    // one puts a page on the canvas if none is out yet. The mobile settings
    // sheet is left standing on purpose: it navigates in place.
    if (ref.kind === "productPage") {
      if (openPages.length === 0 && defaultPageProductId) {
        openProductPage(defaultPageProductId, ref);
      } else {
        setSettingTarget(freshSettingRef(ref));
        setPanelOpen(true);
      }
      return;
    }
    const onProductTile =
      selectedBlocks.length === 1 && selectedBlocks[0]?.type === "product";
    // A per-tile setting reaches the inspector only when there is a tile that
    // HAS it; everything else belongs to the storefront panel.
    if (!(isPerTileSetting(ref) && onProductTile)) setInspector(null);
    setSettingTarget(freshSettingRef(ref));
    setSettingsOpen(false);
    setPanelOpen(true);
  }

  /**
   * Put a product's page on the canvas beside the board, and aim the design
   * panel at the page's settings.
   *
   * The board stays exactly where it is. That is the whole point of the
   * artboard model: a page is not a screen the editor switches to, it is
   * another thing on the same workspace, joined to the tile that opens it.
   */
  function openProductPage(
    productId: string,
    ref: SettingRef = { kind: "productPage", section: "layout" },
  ) {
    setOpenPages((current) =>
      current.includes(productId) ? current : [...current, productId],
    );
    setSettingTarget(freshSettingRef(ref));
    setPanelOpen(true);
    revealArtboard();
  }

  function closeProductPage(productId: string) {
    setOpenPages((current) => current.filter((id) => id !== productId));
  }

  /** The node on a tile is a toggle: pressing it again puts the page away. */
  function togglePageForProduct(productId: string) {
    if (openPages.includes(productId)) closeProductPage(productId);
    else openProductPage(productId);
  }

  /** The toolbar's button: show the page for whatever the seller is on, or
   *  put every open page away. */
  function toggleProductPages() {
    if (openPages.length > 0) {
      setOpenPages([]);
      return;
    }
    if (defaultPageProductId) openProductPage(defaultPageProductId);
  }

  /**
   * Pan (and, if it no longer fits, zoom) the workspace so a page that has
   * just opened is actually on screen — ALONGSIDE the board, not instead of
   * it. Without this, opening a page 700px to the right of the board looks
   * like nothing happened.
   *
   * This used to aim at the one artboard that just opened, which for a wide
   * board plus a wide page routinely panned the board itself off the left
   * edge — defeating the whole point of the artboard model (seeing a tile
   * and its page at once) and, now that the device switch lives on the
   * board, making that switch unreachable right when a seller most wants it.
   * Fitting the WHOLE stage instead keeps the board in view with everything
   * open beside it, the same way the first-paint placement does — the
   * current zoom is kept if it still fits, so opening a second page doesn't
   * reset a zoom level the seller just set.
   *
   * Deferred a frame so the newly opened artboard has actually laid out;
   * measured rather than computed, because how wide the stage now is
   * depends on the board width, the gap and whatever else is already out.
   */
  function revealArtboard() {
    requestAnimationFrame(() => {
      const view = measureView();
      const room = safeWindow();
      if (!view || !room) return;
      const { zoom: currentZoom } = viewport.get();
      const fits =
        view.width * currentZoom + CANVAS_MARGIN * 2 <= room.width &&
        view.height * currentZoom + CANVAS_MARGIN * 2 <= room.height;
      const zoom = fits
        ? currentZoom
        : clampZoom(
            Math.min(
              (room.width - CANVAS_MARGIN * 2) / view.width,
              (room.height - CANVAS_MARGIN * 2) / view.height,
            ),
          );
      viewport.set(
        {
          zoom,
          pan: {
            x: room.minX + (room.width - view.width * zoom) / 2,
            y: room.minY + CANVAS_MARGIN,
          },
        },
        { animate: true },
      );
    });
  }

  function updateTheme(next: StorefrontTheme) {
    recordChange(`theme:${changedField(theme, next)}`);
    setTheme(next);
  }

  function updateHeader(next: StorefrontHeader) {
    recordChange(`header:${changedField(header, next)}`);
    setHeader(next);
  }

  function updateProductPage(next: ProductPageConfig) {
    recordChange(`productPage:${changedField(productPage, next)}`);
    setProductPage(next);
  }


  function updateName(next: string) {
    markDirty();
    setName(next);
  }

  /** Commit a dragged/keyed panel edge: clamp to the max, and treat anything
   *  under the minimum as "collapse" rather than shrinking further. */
  function resizePanelTo(width: number): boolean {
    if (width < PANEL_MIN_WIDTH) {
      setPanelOpen(false);
      return false;
    }
    setPanelWidth(Math.min(PANEL_MAX_WIDTH, width));
    return true;
  }

  /** Pointer-drag the panel's left edge. The panel is flush with the right
   *  side of the viewport, so its width is simply the distance from the
   *  pointer to that edge. */
  function startPanelResize(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const startWidth = panelWidth;

    function onMove(moveEvent: PointerEvent) {
      if (!resizePanelTo(window.innerWidth - moveEvent.clientX)) {
        // Collapsed by dragging past the minimum: reopen at the width the
        // panel had BEFORE this drag, not the sliver it passed through on
        // the way out.
        setPanelWidth(startWidth);
        stop();
      }
    }
    function stop() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      // Restore the text selection / cursor suppression used while dragging.
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }

  function onPanelResizeKey(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      resizePanelTo(panelWidth + PANEL_RESIZE_STEP);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      resizePanelTo(panelWidth - PANEL_RESIZE_STEP);
    }
  }

  function applyProductUpdate(updated: Product) {
    setCatalog((current) =>
      current.map((p) => (p.id === updated.id ? updated : p)),
    );
  }

  /**
   * Merge picker-search results into the catalogue. The seed catalogue is
   * bounded (newest 500), so a search can surface products this component has
   * never seen; they must exist in `catalog` before a block referencing them
   * renders, or the block would be dropped as unknown. Existing entries win:
   * they may carry local edits (applyProductUpdate) not yet reflected in a
   * stale search payload.
   */
  const mergeFoundProducts = useCallback((found: Product[]) => {
    if (found.length === 0) return;
    setCatalog((current) => {
      const known = new Set(current.map((p) => p.id));
      const fresh = found.filter((p) => !known.has(p.id));
      return fresh.length > 0 ? [...current, ...fresh] : current;
    });
  }, []);

  /** Returns whether the save succeeded, so callers (e.g. save-then-leave) can
   *  branch on it without re-reading async state. */
  async function handleSave(): Promise<boolean> {
    setSaving(true);
    // Policies travel trimmed and without empty fields; nothing at all when
    // every field is blank. The product page's options are written once they
    // differ from the defaults (or were already stored), so a storefront
    // nobody turned towards its product page saves byte-identical to the one
    // it was before the page existed.
    //
    // NOTHING TO COMPACT for the seller, the policies or the shipping
    // profiles: all three are account-level and this editor never writes
    // them (lib/settings/seller-identity.ts,
    // lib/settings/shipping-actions.ts). That is the point of the move — a
    // save here cannot reach the terms every OTHER storefront is also
    // selling under.
    const config: StorefrontConfig = {
      theme,
      // Blocks carry their own coordinates, so array order is irrelevant.
      blocks,
      header,
      // Embed settings are edited in the list-page modal, not here — pass the
      // loaded value through so a designer save never wipes them.
      ...(initialConfig.embed ? { embed: initialConfig.embed } : {}),
      ...(initialConfig.productPage || !isDefaultProductPage(productPage)
        ? { productPage }
        : {}),
    };
    // SF-01: Warn when any block in the grid points at a draft product.
    // Draft products are hidden from buyers, so a grid tile that points at one
    // would lead buyers to a dead link. The save still succeeds (the seller
    // may be about to publish the product), but they hear about it.
    const draftBlockTitles = blocks
      .flatMap((b) => {
        if (b.type !== "product") return [];
        const p = productsById.get(b.productId);
        return p?.status === "draft" ? [p.title] : [];
      });

    const result = await saveStorefront(storefrontId, { name, config });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error.message, { lines: [result.error.fix] });
      return false;
    }
    if (result.droppedBlocks > 0) {
      // Server dropped refs to deleted products; mirror that locally.
      setBlocks((current) =>
        current.filter(
          (b) => b.type !== "product" || productsById.has(b.productId),
        ),
      );
    }
    setDirty(false);
    // Blocks silently vanishing from the canvas needs saying out loud --
    // otherwise a save that quietly removed tiles reads as a save that broke
    // the design.
    if (draftBlockTitles.length > 0) {
      const names = draftBlockTitles.slice(0, 3).join(", ");
      const more = draftBlockTitles.length > 3 ? ` and ${draftBlockTitles.length - 3} more` : "";
      toast.info("Saved, but some products are still drafts.", {
        lines: [
          `${names}${more} ${draftBlockTitles.length === 1 ? "is a draft" : "are drafts"} and buyers cannot reach ${draftBlockTitles.length === 1 ? "it" : "them"} yet.`,
          "Publish those products when ready.",
        ],
      });
    } else {
      toast.success("Storefront saved.", {
        lines:
          result.droppedBlocks > 0
            ? [
                result.droppedBlocks === 1
                  ? "1 block pointed at a deleted product and was removed."
                  : `${result.droppedBlocks} blocks pointed at deleted products and were removed.`,
              ]
            : undefined,
      });
    }
    return true;
  }

  // Save from inside the leave prompt: only navigate away if it actually saved,
  // otherwise close the prompt so the inline error banner is visible.
  async function handleSaveAndLeave() {
    if (await handleSave()) leaveGuard.leave();
    else leaveGuard.cancel();
  }

  const inspectorTitle =
    inspector?.kind === "picker"
      ? "Add product"
      : selectedBlocks.length > 1
        ? `${selectedBlocks.length} blocks`
        : selectedBlock?.type === "product"
          ? "Product"
          : selectedBlock?.type === "shape"
            ? "Shape"
            : // Named per type rather than falling through to the last one: an
              // image block used to be titled "Text block", because the chain
              // ended in text and nothing tested the image case.
              selectedBlock?.type === "image"
              ? "Image"
              : "Text block";
  const showInspector =
    inspector?.kind === "picker" || selectedBlocks.length > 0;

  // WHICH PANEL HAS THE PHONE'S ONE BOTTOM SLOT (null on lg+, where they are
  // columns and share nothing). Everything that has to agree about the sheets
  // reads this one answer: which one is drawn, and whether the floating toolbar
  // stands down. See activeMobileSheet for the order and why it is that order.
  /** Whether the colour panel is showing its "here I am" mark right now. */
  const colorPanelFlash = useSummonFlash(colorSummons);

  const mobileSheet = activeMobileSheet({
    layers: layersOpen,
    settings: settingsOpen,
    library: leftPanel?.kind === "library",
    color: activeColorTarget !== null,
    inspector: showInspector,
  });

  return (
    // Universal search, mounted here rather than inherited: the editor renders
    // full-screen OUTSIDE the dashboard shell (see storefront/layout.tsx), so
    // without this ⌘K would be dead on the one surface people sit in longest.
    //
    // `navigate` goes through the leave guard on purpose. A bare router.push
    // from a search result would walk out of the editor and take any unsaved
    // canvas edits with it, silently — the same trap the header's Back link
    // already routes around.
    // Lets every color field below — the theme colors in the right-hand panel
    // and the block colors in the inspector — hand itself to the left-hand
    // ColorPanel. Only the OPENER travels through context; the panel's data
    // comes down as props from here.
    <ColorTargetProvider
      value={{
        activeRef: activeColorTarget,
        open: openColorTarget,
        close: () => setColorTarget(null),
      }}
    >
    <SettingTargetProvider
      value={{
        activeRef: settingTarget,
        open: openSetting,
        close: () => setSettingTarget(null),
      }}
    >
    <SearchProvider
      role={role}
      accountId={accountId}
      // A search result naming a setting in THIS storefront is not a
      // navigation: intercept it and open the panel in place, so the editor
      // never reloads (and the unsaved-changes guard never has to ask) for
      // something that was only ever a request to look at a control.
      navigate={(href) => {
        const id = settingIdFromHref(href);
        const entry = id ? settingById(id) : null;
        if (entry) {
          openSetting(entry.ref);
          return;
        }
        leaveGuard.requestLeave(href);
      }}
    >
      {/* Fixed-height workspace: the PAGE never scrolls. The canvas column and
          the design panel each scroll on their own, so a tall storefront moves
          under the toolbar without dragging the chrome off screen. */}
      <div className="flex h-dvh flex-col overflow-hidden bg-background">
      {/* Full-screen editor top bar — no sidebar here, so this is the only
          chrome. Pinned by the layout, so it needs no sticky positioning. */}
      <header className="shrink-0 border-b border-border bg-background">
        <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
          <Link
            href="/storefront"
            aria-label="Back to storefronts"
            className={iconButtonClass}
            // Route through the guard so unsaved edits prompt first; keep the
            // href so middle-click / open-in-new-tab still work.
            onClick={(event) => {
              event.preventDefault();
              leaveGuard.requestLeave("/storefront");
            }}
          >
            <ArrowLeft
              className={cn("size-4", iconNudgeLeftClass)}
              strokeWidth={2}
              aria-hidden="true"
            />
          </Link>

          <div className="min-w-0 flex-1">
            <label htmlFor="storefront-name" className="sr-only">
              Storefront name
            </label>
            <input
              id="storefront-name"
              suppressHydrationWarning
              value={name}
              onChange={(event) => updateName(event.target.value)}
              placeholder="Untitled storefront"
              maxLength={STOREFRONT_NAME_MAX}
              spellCheck={false}
              className="w-full max-w-md truncate rounded-sm border border-transparent bg-transparent px-2 py-1 text-lg font-semibold text-foreground placeholder:text-muted-foreground hover:border-border focus:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
          </div>

          <div className="flex items-center gap-3">
            <DesignerSearchButton />
            {/* The one thing the header says is whether there is work not yet
                written. What HAPPENED when Save was pressed is a toast, which
                reaches the phone and the desktop identically — this used to be
                `hidden sm:inline`, so tapping Save on a 390px screen confirmed
                nothing at all. */}
            {dirty && !saving && (
              // A PHONE GETS THE WORDS OR NOTHING, never a bare dot. There was
              // one, between the search button and Save, and a lone ● in a row
              // of two framed controls reads as a third control with its label
              // missing rather than as a state. The phrase itself has no room
              // there, so on a phone this is announced and not drawn.
              //
              // `max-sm:sr-only` rather than a second element: sr-only is
              // absolutely positioned, so it stops being a flex item too, and
              // the row closes up instead of keeping the gap the dot sat in.
              <span
                role="status"
                className={`shrink-0 max-sm:sr-only ${helpTextClass}`}
              >
                Unsaved changes
              </span>
            )}
            {/* h-9 py-0 pairs it with the search button beside it: the default
                button is 40px tall (py-2.5 + text-sm) against that button's
                36px, and two controls of different heights sitting side by side
                in the same bar look like a mistake rather than a hierarchy. */}
            <Button onClick={handleSave} disabled={saving} className="h-9 py-0">
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </header>

      {/* SF-09: Mobile editing notice. The designer is functional on a phone
          but 55px cells and 24px control chips make precise editing hard.
          This banner only appears below the lg breakpoint where full layout
          is not available, and links to the storefront list rather than
          implying features that are not there.

          IT CLOSES. It used to be permanent furniture, which is fine advice
          for someone who can act on it and a two-line tax on the workspace for
          everyone who cannot. A seller running the shop from a phone reads it
          once and then owns it forever. See noticeDismissed for why the answer
          is remembered rather than asked again on the next load. */}
      {!noticeDismissed && (
        <div className="flex shrink-0 items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 font-inter text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300 lg:hidden">
          <p className="min-w-0 flex-1">
            For the best editing experience, open this designer on a desktop or
            tablet. Reordering blocks and editing the header work on any device.
          </p>
          {/* -my-1 keeps a 44px touch target from making the banner taller than
              the text needs: the button overflows into the row's own padding
              rather than pushing the canvas further down the screen. */}
          <button
            type="button"
            suppressHydrationWarning
            onClick={dismissMobileNotice}
            aria-label="Dismiss the small-screen editing notice"
            className="-my-1 -mr-2 inline-flex size-9 shrink-0 items-center justify-center rounded-sm text-amber-800 transition-colors duration-base ease-standard hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-amber-300 dark:hover:bg-amber-900/40 motion-reduce:transition-none"
          >
            <X className="size-4" strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Full-width workspace. `relative` positions the floating left layer;
          the design column on the right is a real flex item beside it. */}
      <div className="relative flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* LEFT: the colour / library panel. A FLOATING LAYER over the canvas,
            not a column beside it, and that is a deliberate split from the
            design panel opposite.

            TRANSIENT PANELS FLOAT, PERSISTENT PANELS DOCK. This one comes and
            goes constantly (every block selected opens it, every deselect shuts
            it), and while it was docked each of those was a LAYOUT change: the
            workspace narrowed, its top-left corner moved, and the board's pan
            is measured from that corner. The canvas then had to be corrected
            by the panel's own width just to appear stationary, which is a
            correction you can see. As a layer it changes no layout at all, so
            there is nothing to correct and nothing to see. The design panel is
            open more or less permanently, so docking it costs one reflow a
            session and buys the canvas its own uncovered width.

            The board still gets out from under it when it lands on something:
            useCanvasAnchor measures this element (data-canvas-panel) and the
            canvas treats the covered strip as unavailable.

            On mobile it was already a bottom sheet over the canvas, which is
            the same arrangement; the one-at-a-time rule there is unchanged. */}
        {leftPanelOpen && (
          <div
            // Reaching in here is still part of an in-place text edit: the
            // editor keeps the words selected (and drawn) instead of ending
            // the edit, so a colour picked here lands on them.
            data-design-panel=""
            // Same chrome as the right-hand design column — full height, flush
            // to the edge, a plain border, no radius or shadow — so the two
            // read as one matched pair. The difference is `absolute` in place
            // of a flex item: this one is a LAYER stacked over the canvas
            // rather than a column beside it, which is what keeps opening and
            // closing it from resizing the workspace (see the note above).
            // The floating toolbar (z-40) stays above it, so the two can
            // overlap at a narrow desktop width without either becoming
            // unreachable.
            className="relative lg:absolute lg:inset-y-0 lg:left-0 lg:z-30 lg:w-[17.5rem] lg:border-r lg:border-border lg:bg-background"
          >
            {/* dir flip puts the scrollbar on the LEFT edge (requested); the
                inner dir="ltr" undoes it for the actual content/text. */}
            <div
              dir="rtl"
              // The canvas measures the element that actually PAINTS: this one
              // fills the layer on lg+ and is the fixed sheet on a phone, while
              // the wrapper above collapses to nothing on a phone and would
              // measure as no cover at all.
              {...{ [CANVAS_PANEL_ATTR]: "" }}
              data-summoned={colorPanelFlash ? "" : undefined}
              className={cn(
                SHEET_ON_MOBILE_CLASS,
                "lg:h-full lg:overflow-y-auto",
                // Lit as a whole when the toolbar's colour button opened it:
                // there is no single field to point at here, the panel IS the
                // answer. Inside the scroll container, so the mark travels with
                // the content rather than sitting over it.
                SUMMON_FLASH_CLASS,
                colorPanelFlash && SUMMON_LIT_CLASS,
                // The wash again, at the DESKTOP width. This element already
                // carries `lg:bg-transparent` from the sheet classes (on a
                // desktop the background belongs to the layer around it), and
                // the plain `bg-accent` above loses to it at exactly the width
                // where the panel is a column and the tint would show.
                colorPanelFlash && "lg:bg-accent",
              )}
            >
              <div dir="ltr">
              {resolvedColorTarget && activeColorTarget ? (
                <ColorPanel
                  // Remount when the field changes so the custom section's
                  // working HSV starts from the new color instead of animating
                  // over from the old one.
                  key={colorTargetKey(activeColorTarget)}
                  target={resolvedColorTarget}
                  typography={headerTypography(activeColorTarget)}
                  inDesign={colorsInDesign}
                  onPick={(hex) => applyColorTarget(activeColorTarget, hex)}
                  onInherit={
                    resolvedColorTarget.inherit
                      ? () => clearColorTarget(activeColorTarget)
                      : undefined
                  }
                  onClose={() => setColorTarget(null)}
                />
              ) : (
                <LibraryPanel
                  tab={leftPanel?.kind === "library" ? leftPanel.tab : "uploads"}
                  onTabChange={(tab) => setLeftPanel({ kind: "library", tab })}
                  uploads={uploads}
                  uploading={uploadingElement}
                  uploadProgress={uploadProgress}
                  canAddBlocks={blocks.length < MAX_BLOCKS}
                  onUpload={addImageBlock}
                  onPlaceUpload={placeUpload}
                  onAddShape={addShapeBlock}
                  onClose={() => setLeftPanel(null)}
                />
              )}
              </div>
            </div>
          </div>
        )}

        {/* The workspace window. Whenever `designView` is showing (desktop, or
            mobile preview with a page open) the board floats inside it and can
            be panned anywhere; otherwise mobile preview stays a plain
            scrolling column. pb clears the floating toolbar. */}
        <main
          ref={canvasViewportRef}
          onPointerDown={designView ? onCanvasPointerDown : undefined}
          onPointerMove={designView ? onCanvasPointerMove : undefined}
          onPointerUp={designView ? onCanvasPointerUp : undefined}
          onPointerCancel={designView ? onCanvasPointerUp : undefined}
          className={cn(
            "relative min-w-0 flex-1",
            designView
              ? "touch-none overflow-hidden"
              : "space-y-6 overflow-auto px-4 py-6 pb-24 sm:px-6",
            panning
              ? "cursor-grabbing"
              : spaceHeld && designView
                ? "cursor-grab"
                : null,
          )}
        >
          {/* A failed save used to paint a banner over the canvas, covering
              the very design the seller was about to try saving again. It is a
              toast now; the "Unsaved changes" flag in the header is what keeps
              saying the work is still not written. */}
          <DesignerCanvas
            blocks={blocks}
            productsById={productsById}
            theme={theme}
            header={header}
            previewMode={previewMode}
            onPreviewModeChange={setPreviewMode}
            backgroundImageUrl={backgroundImageUrl}
            customFontUrl={customFontUrl}
            elementUrls={elementUrls}
            showGrid={showGrid}
            viewport={viewport}
            onMoveBlock={onMoveBlock}
            onResizeBlock={onResizeBlock}
            onRotateBlock={onRotateBlock}
            onEmptyCellClick={onInsertAt}
            onAddProduct={togglePicker}
            selectedKeys={selectedKeys}
            onSelectBlock={onSelectBlock}
            onSelectMany={onSelectMany}
            activeHeaderLine={activeHeaderLine}
            onSelectHeaderLine={onSelectHeaderLine}
            editingHeaderLine={editingHeaderLine}
            editingHeaderRange={headerEdit?.range ?? null}
            onEditHeaderLine={onEditHeaderLine}
            onHeaderTextChange={onHeaderTextChange}
            onToggleHeaderFormat={onToggleHeaderFormat}
            onHeaderEditEnd={onHeaderEditEnd}
            framingKey={framingKey}
            onFrameBlock={onFrameBlock}
            onFramePlacement={onFramePlacement}
            onFrameExit={onFrameExit}
            typingKey={typing?.key ?? null}
            typingSelectAll={typing?.selectAll ?? false}
            onTypeStart={onTypeStart}
            onTextChange={onTextChange}
            onToggleBlockFormat={onToggleBlockFormat}
            onTextRangeChange={setTypingRange}
            onTypeEnd={onTypeEnd}
            onSpotChange={placeTileSpot}
            onOpenSpotSetting={openTileLabelSetting}
            // Space is the hold-to-pan tool; while held, a drag on the frame
            // pans the workspace instead of drawing a marquee.
            disableMarquee={spaceHeld}
            // The product pages the seller has out, beside the board.
            openPages={openPages}
            onClosePage={closeProductPage}
            storefrontId={storefrontId}
            storefrontName={name}
            productPage={productPage}
            shippingPolicy={shippingPolicy}
            seller={sellerIdentity}
          />

          {/* The selected block's tools, floating over the top of the canvas
              rather than on the tile itself. Inside <main> (which is
              `relative`) but outside the stage, so it holds its place and its
              size while the board pans and zooms under it. Not while framing
              or typing: the tile owns every gesture then, and this bar's
              buttons all mean "leave that mode and do something else". */}
          {designView && framingKey === null && typing === null && (
            <SelectionToolbar
              blocks={selectedBlocks}
              productsById={productsById}
              elementUrls={elementUrls}
              openPages={openPages}
              // So the bar can follow its block through a pan and a zoom.
              viewport={viewport}
              onOpenPage={togglePageForProduct}
              onType={onTypeStart}
              onFrame={onFrameBlock}
              onOpenColor={(key, part) => {
                openColorTarget({
                  kind: part === "fill" ? "shape-fill" : "shape-border",
                  blockKey: key,
                });
                setColorSummons(colorSummonsNonce.current++);
              }}
              // Stroke, corners and opacity point at the inspector's own copy
              // of the control rather than opening one over the block: the bar
              // sits ON the block, so a popover under it covers the very shape
              // whose number is being dragged. The panel is docked beside the
              // canvas and covers nothing.
              onOpenSetting={(_key, field) => openBlockField(field)}
              onDuplicate={duplicateBlocks}
              onRemove={removeBlocks}
            />
          )}
        </main>

        {/* RIGHT: the design panel, docked to the page edge on desktop, with
            the selected element and the global settings as two tabbed scopes.
            See DesignPanel for why they are tabs rather than one column. */}
        <DesignPanel
          panelOpen={panelOpen}
          onPanelOpenChange={setPanelOpen}
          panelWidth={panelWidth}
          minWidth={PANEL_MIN_WIDTH}
          maxWidth={PANEL_MAX_WIDTH}
          onResizePointerDown={startPanelResize}
          onResizeKeyDown={onPanelResizeKey}
          selectionKey={
            inspector?.kind === "picker"
              ? "picker"
              : selectedKeys.join(",")
          }
          showInspector={showInspector}
          inspectorTitle={inspectorTitle}
          onCloseInspector={() => setInspector(null)}
          // On mobile every panel is the SAME bottom slot, and selecting a
          // shape opens both this and the color sheet — which would stack one
          // on top of the other. The color sheet wins while it is open;
          // closing it brings this back. On lg+ they are separate columns.
          //
          // The library sheet (left panel) is the same conflict from the other
          // side: inserting a block from it selects that block, which would
          // pop this sheet up over the still-open library, hiding the very
          // shapes the seller was choosing from. The library wins for the same
          // reason the color sheet does.
          //
          // Both of those are now one question asked in one place, so this is
          // simply "the slot went to somebody else".
          inspectorHiddenOnMobile={mobileSheet !== "inspector"}
          settingsOpen={settingsOpen}
          onCloseSettings={() => setSettingsOpen(false)}
          layersOpen={layersOpen}
          layers={
            <LayersPanel
              blocks={blocks}
              productsById={productsById}
              elementUrls={elementUrls}
              selectedKeys={selectedKeys}
              onSelect={selectFromLayers}
              onReorder={(key, op) => reorderLayers([key], op)}
              onMoveTo={moveLayer}
              onBack={() => setLayersOpen(false)}
            />
          }
          controls={
            <ControlsPanel
              theme={theme}
              header={header}
              onThemeChange={updateTheme}
              onHeaderChange={updateHeader}
              backgroundImageUrl={backgroundImageUrl}
              onBackgroundImageChange={setBackgroundImageUrl}
              customFontUrl={customFontUrl}
              onCustomFontUrlChange={setCustomFontUrl}
              showGrid={showGrid}
              onShowGridChange={setShowGrid}
              onCanvasChange={updateCanvas}
              blockCount={blocks.length}
              onOpenLayers={() => setLayersOpen(true)}
              searchEntries={editorSearchEntries}
              onJump={jumpTo}
              productPage={productPage}
              onProductPageChange={updateProductPage}
              shippingPolicy={shippingPolicy}
              sellerIdentity={sellerIdentity}
            />
          }
          inspector={
            <>
                  {/* How the selection SITS, above what it is made of: the
                      block editors end in Duplicate and Remove, and a control
                      that only tilts things has no business below a delete
                      button. Shown for every kind, including a mixed
                      selection, since placement is the one thing they all
                      share. */}
                  {inspector?.kind !== "picker" && selectedBlocks.length > 0 && (
                    <div className="mb-4 border-b border-border pb-4">
                      <PlacementSection
                        blocks={selectedBlocks}
                        board={blocks}
                        onRotate={(degrees) =>
                          rotateBlocks(selectedKeys, degrees)
                        }
                        onReorder={(op) => reorderLayers(selectedKeys, op)}
                        onOpenLayers={() => setLayersOpen(true)}
                      />
                    </div>
                  )}
                  {inspector?.kind === "picker" ? (
                    <ProductPicker
                      products={catalog}
                      usedProductIds={usedProductIds}
                      onAdd={addProduct}
                      onFound={mergeFoundProducts}
                    />
                  ) : selectedBlocks.length > 1 ? (
                    <MultiBlockEditor
                      blocks={selectedBlocks}
                      theme={theme}
                      onProductStyleChange={(patch) =>
                        updateProductBlocksStyle(selectedKeys, patch)
                      }
                      onProductStyleReset={() =>
                        resetProductBlocksStyle(selectedKeys)
                      }
                      onShapeChange={(patch) =>
                        updateShapeBlocks(selectedKeys, patch)
                      }
                      onTextChange={(patch) =>
                        updateTextBlocks(selectedKeys, patch)
                      }
                      onDuplicate={() => duplicateBlocks(selectedKeys)}
                      onRemove={() => removeBlocks(selectedKeys)}
                    />
                  ) : selectedBlock?.type === "product" ? (
                    <ProductBlockEditor
                      // Keyed by product so the name/price drafts reset when
                      // the selection moves to a different product tile.
                      key={selectedBlock.productId}
                      block={selectedBlock}
                      theme={theme}
                      product={productsById.get(selectedBlock.productId) ?? null}
                      onStyleChange={(patch) =>
                        updateProductBlocksStyle([blockKey(selectedBlock)], patch)
                      }
                      onStyleReset={() =>
                        resetProductBlocksStyle([blockKey(selectedBlock)])
                      }
                      onRemove={() => removeBlock(blockKey(selectedBlock))}
                      onProductSaved={applyProductUpdate}
                      pageOpen={openPages.includes(selectedBlock.productId)}
                      onDesignPage={() => togglePageForProduct(selectedBlock.productId)}
                    />
                  ) : selectedBlock?.type === "shape" ? (
                    <ShapeBlockEditor
                      block={selectedBlock}
                      summons={blockField}
                      onUpdate={(patch) =>
                        updateShapeBlocks([blockKey(selectedBlock)], patch)
                      }
                      onDuplicate={() =>
                        duplicateBlocks([blockKey(selectedBlock)])
                      }
                      onRemove={() => removeBlock(blockKey(selectedBlock))}
                    />
                  ) : selectedBlock?.type === "text" ? (
                    <TextBlockEditor
                      block={selectedBlock}
                      accent={theme.accent}
                      hasCustomFont={theme.customFont !== undefined}
                      onUpdate={(patch) =>
                        updateTextBlocks([blockKey(selectedBlock)], patch)
                      }
                      onDuplicate={() =>
                        duplicateBlocks([blockKey(selectedBlock)])
                      }
                      // Text had no remove button of its own here, alone among
                      // the kinds: the pair belongs together, and the canvas
                      // route to it (select, then the island's bin) is not one
                      // a seller looking at the inspector can see.
                      onRemove={() => removeBlock(blockKey(selectedBlock))}
                      onEditText={() => beginTyping(blockKey(selectedBlock))}
                      // Colour follows the caret: with words selected on the
                      // canvas it paints them, otherwise the whole block.
                      selectedRange={textRangeTarget?.range ?? null}
                      onColorChange={(color) =>
                        setTextColor(blockKey(selectedBlock), color)
                      }
                    />
                  ) : selectedBlock?.type === "image" ? (
                    <ImageBlockEditor
                      block={selectedBlock}
                      summons={blockField}
                      canFrame={
                        elementUrls[blockKey(selectedBlock)] !== undefined
                      }
                      onUpdate={(patch) =>
                        updateImageBlocks(
                          [blockKey(selectedBlock)],
                          patch,
                          // Coalesce the opacity drag into one undo step; a
                          // fit or alt change is its own.
                          patch.opacity !== undefined
                            ? `image:${blockKey(selectedBlock)}`
                            : undefined,
                        )
                      }
                      onFrame={() => frameBlock(blockKey(selectedBlock))}
                      onDuplicate={() =>
                        duplicateBlocks([blockKey(selectedBlock)])
                      }
                      onRemove={() => removeBlock(blockKey(selectedBlock))}
                    />
                  ) : null}
            </>
          }
        />
      </div>

      <EditorToolbar
        onAddProduct={togglePicker}
        onAddText={addTextBlock}
        onAddShape={addShapeBlock}
        onAddElement={addImageBlock}
        uploadingElement={uploadingElement}
        onOpenShapesPanel={() => {
          setLeftPanel({ kind: "library", tab: "shapes" });
          setSettingsOpen(false);
        }}
        canAddBlocks={blocks.length < MAX_BLOCKS}
        viewport={viewport}
        onZoomIn={() => zoomBy(ZOOM_STEP)}
        onZoomOut={() => zoomBy(-ZOOM_STEP)}
        onZoomReset={resetZoom}
        onTidy={tidyBlocks}
        canTidy={blocks.length > 0}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onUndo={undo}
        onRedo={redo}
        settingsOpen={settingsOpen}
        onToggleSettings={toggleSettings}
        sheetOpen={mobileSheet !== null}
        pagesOpen={openPages.length > 0}
        canOpenPage={defaultPageProductId !== null}
        onTogglePages={toggleProductPages}
      />

      <Modal
        open={leaveGuard.promptOpen}
        onClose={leaveGuard.cancel}
        title="Save your changes?"
        description="You have unsaved changes to this storefront. Save them before leaving, or discard them."
      >
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button
            onClick={handleSaveAndLeave}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save changes"}
          </Button>
          <Button
            variant="destructive"
            onClick={leaveGuard.leave}
            disabled={saving}
          >
            Discard changes
          </Button>
          {/* mr-auto pushes "Keep editing" to the opposite end from the two
              leave actions, so it's not mistaken for one of them. */}
          <Button
            variant="ghost"
            onClick={leaveGuard.cancel}
            disabled={saving}
            className="sm:mr-auto"
          >
            Keep editing
          </Button>
        </div>
      </Modal>
      </div>
    </SearchProvider>
    </SettingTargetProvider>
    </ColorTargetProvider>
  );
}

/**
 * Search entry point for the editor's own top bar. A separate component
 * because it has to be a DESCENDANT of the SearchProvider above to read its
 * context — the designer itself renders that provider, so it cannot use the
 * hook directly. Styled with the editor's icon-button chrome rather than the
 * dashboard trigger, since this bar has no room for a field.
 */
function DesignerSearchButton() {
  const search = useSearch();
  // Anchor the palette under this button, same as the dashboard trigger — the
  // editor's is at the bar's right, so the panel drops down right-side there.
  const buttonRef = useRef<HTMLButtonElement>(null);
  const registerAnchor = search?.registerAnchor;
  useEffect(() => registerAnchor?.(buttonRef.current), [registerAnchor]);
  if (!search) return null;
  return (
    <button
      ref={buttonRef}
      type="button"
      suppressHydrationWarning
      onClick={search.open}
      aria-label="Search"
      aria-haspopup="dialog"
      aria-expanded={search.isOpen}
      aria-keyshortcuts="Meta+K Control+K"
      className={iconButtonClass}
    >
      <Search className="size-4" strokeWidth={2} aria-hidden="true" />
    </button>
  );
}
