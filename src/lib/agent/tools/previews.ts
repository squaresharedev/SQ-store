import { z } from "zod";
import { agentPreviewEnabled } from "@/lib/agent/access";
import {
  PRODUCT_PAGE_PREVIEW_VIEW_URI,
  PUBLISH_CARD_VIEW_URI,
  STOREFRONT_PREVIEW_VIEW_URI,
  productPagePreviewUrl,
  storefrontPreviewUrl,
} from "@/lib/agent/paths";
import { productPagePreview, type ProductPagePreviewNotes } from "@/lib/agent/preview/product-page-preview";
import { PUBLISH_CARD_VIEW_HTML } from "@/lib/agent/preview/publish-card";
import {
  croppedAsAsked,
  pictureScale,
  takeSnapshot,
  type PreviewViewport,
  type SnapshotOptions,
} from "@/lib/agent/preview/snapshot";
import { storefrontPreview, type StorefrontPreviewNotes } from "@/lib/agent/preview/storefront-preview";
import {
  readMeasurements,
  type CellRegion,
  type MeasuredTile,
  type PageBox,
  type PreviewMeasurements,
} from "@/lib/agent/preview/targets";
import { LIVE_PREVIEW_TOKEN_SECONDS, mintPreviewToken, type PreviewSubject } from "@/lib/agent/preview/token";
import { PAGE_PREVIEW_VIEW_HTML } from "@/lib/agent/preview/view";
import { READ, ToolFailure, ToolMedia, defineTool } from "@/lib/agent/tool";
import { appOrigin, appUrl } from "@/lib/app-url";
import { invalidInput, notFound, rateLimited } from "@/lib/errors";
import { msg } from "@/i18n/types";
import { productEditPath } from "@/lib/products/paths";
import { r2Origin } from "@/lib/r2";
import { RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { boardSummary } from "@/lib/storefront/design-ops";
import { storefrontEditorPath } from "@/lib/storefront/paths";
import { productPageUrl } from "@/lib/storefront/product-page-url";
import { getStorefront } from "@/lib/storefront/queries";

/**
 * PREVIEWS: a page as a browser draws it, for the model and, in a host with MCP
 * Apps, for the seller beside the conversation (docs/mcp-apps.md).
 */

/** What a view may reach beyond itself, as MCP Apps `_meta.ui.csp`. */
export type ViewCsp = { connectDomains?: string[]; resourceDomains?: string[] };

/** Where stored photos come from, exactly (see r2Origin), when there are any. */
function photoOrigins(): string[] {
  const origin = r2Origin();
  return origin ? [origin] : [];
}

/**
 * Every view a tool names, as the transport serves them from resources/read.
 * `available` decides whether a tool points at its view at all: a view that
 * would have nothing to draw is better not opened.
 *
 * The page preview reads the live preview page from this app (connect) and
 * shows its markup with this app's stylesheets, fonts and photos (resources).
 * Not a nested iframe: Claude restricts `frameDomains` pending its own security
 * review, so the page's HTML is fetched and drawn in the view itself. The
 * publish card reads nothing; it only shows the products' photos.
 */
export const AGENT_VIEWS: Record<
  string,
  { name: string; title: string; description: string; html: string; csp: () => ViewCsp; available: () => boolean }
> = {
  [STOREFRONT_PREVIEW_VIEW_URI]: {
    name: "storefront-preview",
    title: "Storefront preview",
    description: "A storefront on a desktop and on a phone, live, with each product tile selectable.",
    html: PAGE_PREVIEW_VIEW_HTML,
    csp: () => ({ connectDomains: [appOrigin()], resourceDomains: [appOrigin(), ...photoOrigins()] }),
    available: agentPreviewEnabled,
  },
  [PRODUCT_PAGE_PREVIEW_VIEW_URI]: {
    name: "product-page-preview",
    title: "Product page preview",
    description: "A product's page on a desktop and on a phone, live, as a buyer would see it.",
    html: PAGE_PREVIEW_VIEW_HTML,
    csp: () => ({ connectDomains: [appOrigin()], resourceDomains: [appOrigin(), ...photoOrigins()] }),
    available: agentPreviewEnabled,
  },
  [PUBLISH_CARD_VIEW_URI]: {
    name: "publish-card",
    title: "Published products",
    description: "What went live and where to open it, and what did not and why.",
    html: PUBLISH_CARD_VIEW_HTML,
    csp: () => ({ resourceDomains: photoOrigins() }),
    available: () => true,
  },
};

/**
 * How much of a result the pictures for the model may take, in base64
 * characters. Claude does not open a view on a tool result past about 150,000
 * characters, so the pictures stay well under it with the words beside them; a
 * picture that does not fit is left out and said so, and the view still shows
 * the page live.
 */
const PICTURE_BUDGET_CHARS = 110_000;

type Pictures = {
  images: { data: string; mimeType: string }[];
  /** Which content block holds each screen's picture (block 0 is the text). */
  imageIndex: Partial<Record<PreviewViewport, number>>;
  measured: Partial<Record<PreviewViewport, PreviewMeasurements>>;
  /** What the model is told about the pictures it did not get. */
  report: {
    pictures: PreviewViewport[];
    picturesTooLargeToSend?: PreviewViewport[];
    picturesMissing?: PreviewViewport[];
    regionNotCropped?: true;
  };
  /** The same, in sentences. */
  pictureNotes: string[];
};

/**
 * Photograph a preview page on each screen, within the result's budget. A
 * picture past what is left of the budget is left out and said so, never cut
 * down; a region the browser did not crop to is left out the same way, never
 * passed off as the region.
 */
async function takePictures(url: string, wanted: PreviewViewport[], options: SnapshotOptions = {}): Promise<Pictures> {
  const shots = await Promise.all(wanted.map((screen) => takeSnapshot(url, screen, options)));
  const images: Pictures["images"] = [];
  const imageIndex: Pictures["imageIndex"] = {};
  const measured: Pictures["measured"] = {};
  const tooLarge: PreviewViewport[] = [];
  const notCropped: PreviewViewport[] = [];
  const pictureNotes: string[] = [];
  let budget = PICTURE_BUDGET_CHARS;
  wanted.forEach((screen, index) => {
    const shot = shots[index];
    if (!shot) return;
    const found = readMeasurements(shot.html);
    if (found) measured[screen] = found;
    if (options.region && !croppedAsAsked(shot.image, found?.region)) {
      notCropped.push(screen);
      pictureNotes.push(
        "The picture could not be cropped to that region (the board was not found, or the browser did not crop), so it was left out. Ask for the whole page instead.",
      );
      return;
    }
    if (shot.image.length > budget) {
      tooLarge.push(screen);
      pictureNotes.push(
        `The ${screen} picture is ${shot.image.length} characters, past the ${budget} a result can still carry, so it was left out. ` +
          (options.region
            ? "Ask for a smaller region."
            : options.resolution === "full"
              ? "Ask for a region of cells to see part of it at full resolution, or the standard resolution for all of it."
              : "Ask for one screen at a time, or a region of cells."),
      );
      return;
    }
    budget -= shot.image.length;
    imageIndex[screen] = 1 + images.length;
    images.push({ data: shot.image, mimeType: shot.mimeType });
  });
  const missing = wanted.filter(
    (screen) => imageIndex[screen] === undefined && !tooLarge.includes(screen) && !notCropped.includes(screen),
  );
  return {
    images,
    imageIndex,
    measured,
    report: {
      pictures: wanted.filter((screen) => imageIndex[screen] !== undefined),
      ...(tooLarge.length ? { picturesTooLargeToSend: tooLarge } : {}),
      ...(missing.length ? { picturesMissing: missing } : {}),
      ...(notCropped.length ? { regionNotCropped: true as const } : {}),
    },
    pictureNotes,
  };
}

/** One preview per grant budget, before any token is minted or browser started. */
async function spendPreview(grantId: string): Promise<void> {
  if (!(await rateLimitKey(`grant:${grantId}`, "agent_preview", RATE_LIMITS.agentPreview))) {
    throw new ToolFailure(rateLimited("agentTools"));
  }
}

/** The link the view reads the page from, for a quarter of an hour. */
function liveToken(subject: PreviewSubject, grantId: string): Promise<string> {
  return mintPreviewToken(subject, grantId, LIVE_PREVIEW_TOKEN_SECONDS);
}

const viewportInput = z.enum(["both", "desktop", "mobile"]).optional().describe("Which screens to take. Both by default.");

const resolutionInput = z
  .enum(["standard", "full"])
  .optional()
  .describe("full pictures the desktop at its real 1280 pixels instead of 800. A long page may then be too large to send, and the answer says so: ask for a region instead.");

const regionInput = z
  .strictObject({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    w: z.number().int().min(1),
    h: z.number().int().min(1),
  })
  .optional()
  .describe("Crop to these board cells (x, y, w, h as in get_storefront), pictured at full resolution on the desktop: the way to judge type and spacing up close.");

function screensFor(viewport: "both" | PreviewViewport): PreviewViewport[] {
  return viewport === "both" ? ["desktop", "mobile"] : [viewport];
}

/**
 * The tiles over a region's crop, in the crop's own pixels: what the view's
 * fallback picture lays its tile targets on, as a share of the "page" it was
 * handed (here, the crop).
 */
function onCrop<Tile extends MeasuredTile>(tiles: Tile[], box: PageBox) {
  return {
    page: { width: box.w, height: box.h },
    tiles: tiles
      .filter((tile) => tile.x < box.x + box.w && box.x < tile.x + tile.w && tile.y < box.y + box.h && box.y < tile.y + tile.h)
      .map((tile) => ({ ...tile, x: tile.x - box.x, y: tile.y - box.y })),
  };
}

/** A region lies on the desktop board, refused in words before a preview is spent. */
function assertRegionOnBoard(
  region: CellRegion,
  viewport: "both" | PreviewViewport,
  theme: { columns: number; rows: number },
): void {
  const refuse = (message: string, fix: string) =>
    new ToolFailure(
      invalidInput(msg("Errors.agent.passThrough", { message }), msg("Errors.agent.passThrough", { message: fix })),
    );
  if (viewport === "mobile") {
    throw refuse("A region is cut from the desktop board.", "Leave viewport out with a region, or ask for the whole phone page without one.");
  }
  if (region.x + region.w > theme.columns || region.y + region.h > theme.rows) {
    throw refuse(
      `The board is ${theme.columns} by ${theme.rows} cells, so that region is not on it.`,
      `x + w may reach ${theme.columns} and y + h may reach ${theme.rows}, as in get_storefront.`,
    );
  }
}

/** The storefront notes in plain sentences, for the model and the view alike. */
function storefrontNotesInWords(notes: StorefrontPreviewNotes): string[] {
  const lines: string[] = [];
  const reasons: Record<StorefrontPreviewNotes["notPublic"][number], string> = {
    product_pages_off: "its product pages are switched off",
    trader_identity_incomplete: "the seller's trader details are not complete",
    taken_down: "it has been taken down",
  };
  if (notes.notPublic.length) {
    lines.push(`Buyers cannot open this storefront yet: ${notes.notPublic.map((reason) => reasons[reason]).join(", and ")}.`);
  }
  const hidden = notes.hiddenFromBuyers.filter((item) => item.reason === "draft" || item.reason === "archived");
  if (hidden.length) {
    lines.push(`Drawn here but not shown to buyers until published: ${hidden.map((item) => item.title ?? item.productId).join(", ")}.`);
  }
  const gone = notes.hiddenFromBuyers.filter((item) => item.reason === "missing" || item.reason === "taken_down");
  if (gone.length) {
    lines.push(`Not drawn (deleted or taken down): ${gone.map((item) => item.title ?? item.productId).join(", ")}.`);
  }
  if (notes.noPhoto.length) {
    lines.push(`No photo, so the tile is an empty frame: ${notes.noPhoto.map((item) => item.title).join(", ")}.`);
  }
  return lines;
}

/** The product page notes in plain sentences. */
function productNotesInWords(notes: ProductPagePreviewNotes, storefrontName: string): string[] {
  const reasons: Record<ProductPagePreviewNotes["notPublic"][number], string> = {
    draft: "it is a draft (publish_products puts it on sale)",
    archived: "it is archived",
    not_on_storefront: `it is not on ${storefrontName}, so it has no page there yet (add it with edit_storefront)`,
    product_pages_off: `${storefrontName}'s product pages are switched off`,
    trader_identity_incomplete: "the seller's trader details are not complete",
    taken_down: "it has been taken down",
  };
  return [
    ...(notes.notPublic.length
      ? [`Buyers cannot open this page yet: ${notes.notPublic.map((reason) => reasons[reason]).join(", and ")}.`]
      : []),
    ...(notes.noPhoto ? ["No photo, so the page shows an empty frame where it would be."] : []),
    ...(notes.noWayToBuy
      ? ["The page has no buy button: there is no purchase link, no contact email for the seller and no checkout for it. Give it a purchaseUrl, or the seller can add a contact email or set up checkout."]
      : []),
  ];
}

/** Picture pixels per page pixel on each screen taken, for reading `tiles` against a picture. */
function scalesFor(screens: PreviewViewport[], options: SnapshotOptions = {}): Partial<Record<PreviewViewport, number>> {
  return Object.fromEntries(
    screens.map((screen) => [screen, options.region ? 1 : pictureScale(screen, options.resolution)]),
  );
}

export const previewTools = [
  defineTool({
    name: "preview_storefront",
    title: "Preview a storefront",
    description:
      "See a storefront the way a buyer's browser draws it: screenshots from a real browser using the live storefront renderer, on a desktop (laid out 1280 wide, pictured 800 wide) and on a phone (390 wide), " +
      "with where each product tile landed, and what keeps any of it from buyers (drafts, missing photos, the store not being public yet). " +
      "Use it after edit_storefront to check your work: overlaps, contrast, empty photo frames, text that does not fit, and how it reads on a phone. " +
      "To judge type and spacing, ask for a region of cells (cropped at full resolution) or resolution full; a picture too large to send is left out and said so, never shrunk. " +
      "Drafts are drawn, because this is the seller's own preview; buyers do not see them. In a host with MCP Apps the seller sees the storefront itself, live, and can switch screens and pick a tile. " +
      "Each call drives a browser, so use it to check a batch of edits, not every one. Up to 30 previews an hour, shared with preview_product_page.",
    scope: "store:read",
    permission: "store.read",
    annotations: READ,
    view: STOREFRONT_PREVIEW_VIEW_URI,
    enabled: agentPreviewEnabled,
    input: z.strictObject({
      id: z.string().describe("The storefront's id."),
      viewport: viewportInput,
      resolution: resolutionInput,
      region: regionInput,
    }),
    handler: async ({ id, viewport = "both", resolution = "standard", region }, { grantId }) => {
      // Read under row level security first: a storefront of another store is
      // not found here, before any token is minted or browser started.
      const storefront = await getStorefront(id);
      if (!storefront) throw new ToolFailure(notFound("storefront"));
      if (region) assertRegionOnBoard(region, viewport, storefront.config.theme);
      await spendPreview(grantId);
      const preview = await storefrontPreview(id);
      if (!preview) throw new ToolFailure(notFound("storefront"));

      // A region is cut from the desktop board alone.
      const wanted: PreviewViewport[] = region ? ["desktop"] : screensFor(viewport);
      const options: SnapshotOptions = region ? { region: true } : { resolution };
      const subject = { kind: "storefront", id } as const;
      const { images, imageIndex, measured, report, pictureNotes } = await takePictures(
        storefrontPreviewUrl(id, await mintPreviewToken(subject, grantId), region),
        wanted,
        options,
      );
      const notes = storefrontNotesInWords(preview.notes);
      const isPublic = preview.notes.notPublic.length === 0;
      const tilesFor = (screen: PreviewViewport) =>
        (measured[screen]?.tiles ?? []).map((tile) => ({
          ...tile,
          ...(isPublic && tile.status === "active" ? { pageUrl: productPageUrl(id, tile.productId) } : {}),
        }));
      const measuredScreens = wanted.filter((screen) => measured[screen]);

      return new ToolMedia(
        {
          storefront: { id: storefront.id, name: storefront.name },
          ...report,
          ...(pictureNotes.length ? { pictureNotes } : {}),
          notes,
          ...(region
            ? {
                // The crop's own place on the page: a tile's picture pixels are
                // its page pixels less this box's x and y.
                region: { cells: region, ...(measured.desktop?.region ? { page: measured.desktop.region } : {}) },
              }
            : { resolution }),
          // Where each product tile (and the board's grid) was drawn, in page
          // pixels; times pictureScale for where it is on that screen's picture.
          tiles: Object.fromEntries(measuredScreens.map((screen) => [screen, measured[screen]])),
          pictureScale: scalesFor(measuredScreens, options),
          board: boardSummary(storefront.config),
        },
        images,
        {
          kind: "storefront",
          storefront: { id: storefront.id, name: storefront.name },
          viewport: wanted[0],
          imageIndex,
          viewports: Object.fromEntries(
            measuredScreens.map((screen) => {
              const crop = region ? measured[screen]?.region : undefined;
              return [screen, crop ? onCrop(tilesFor(screen), crop) : { page: measured[screen]?.page, tiles: tilesFor(screen) }];
            }),
          ),
          links: { designer: appUrl(storefrontEditorPath(id)) },
          // The page the view draws live; `vp=mobile` gives its phone board.
          live: { url: storefrontPreviewUrl(id, await liveToken(subject, grantId)) },
          notes,
        },
      );
    },
  }),

  defineTool({
    name: "preview_product_page",
    title: "Preview a product page",
    description:
      "A product exactly as a buyer would see it on its hosted page, including any running sale and its stock badge; priceCents is what a buyer pays now. Drafts are drawn too, since this is the seller's own preview, and `notes` says what keeps the page from buyers. " +
      "The page wears a storefront's look: the one you name, or else the storefront the product is on, or else the store's newest. " +
      "Where previews are switched on it also answers with screenshots from a real browser, on a desktop (pictured 800 wide) and on a phone (390 wide), and in a host with MCP Apps the seller sees the page itself, live. " +
      "Pictures count against the 30 previews an hour shared with preview_storefront.",
    scope: "store:read",
    permission: "store.read",
    annotations: READ,
    view: PRODUCT_PAGE_PREVIEW_VIEW_URI,
    input: z.strictObject({
      id: z.string().describe("The product's id."),
      storefrontId: z.string().optional().describe("Whose look and address the page has. Leave out for the storefront the product is on."),
      viewport: viewportInput,
    }),
    handler: async ({ id, storefrontId, viewport = "both" }, { grantId }) => {
      const preview = await productPagePreview(id, storefrontId);
      if (preview === "no_storefront") {
        throw new ToolFailure(invalidInput(msg("Errors.agent.noStorefrontForPage"), msg("Errors.agent.noStorefrontForPageFix")));
      }
      if (!preview) throw new ToolFailure(notFound(storefrontId ? "storefront" : "product"));
      const { page, status } = preview;
      const notes = productNotesInWords(preview.notes, page.storefront.name);
      const data = {
        product: page.product,
        addOns: page.addOns ?? [],
        status,
        storefront: { id: page.storefront.id, name: page.storefront.name },
        notes,
      };
      if (!agentPreviewEnabled()) return data;

      await spendPreview(grantId);
      const subject = { kind: "product", id } as const;
      const { images, imageIndex, report, pictureNotes } = await takePictures(
        productPagePreviewUrl(id, page.storefront.id, await mintPreviewToken(subject, grantId)),
        screensFor(viewport),
      );
      const isPublic = preview.notes.notPublic.length === 0;
      return new ToolMedia({ ...data, ...report, ...(pictureNotes.length ? { pictureNotes } : {}) }, images, {
        kind: "product",
        product: { id, title: page.product.title },
        viewport: screensFor(viewport)[0],
        imageIndex,
        links: {
          edit: appUrl(productEditPath(id)),
          ...(isPublic ? { page: productPageUrl(page.storefront.id, id) } : {}),
        },
        live: { url: productPagePreviewUrl(id, page.storefront.id, await liveToken(subject, grantId)) },
        notes,
      });
    },
  }),
];
