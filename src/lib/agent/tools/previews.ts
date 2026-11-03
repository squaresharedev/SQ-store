import { z } from "zod";
import { agentPreviewEnabled } from "@/lib/agent/access";
import { STOREFRONT_PREVIEW_VIEW_URI, storefrontPreviewUrl } from "@/lib/agent/paths";
import { takeSnapshot, type PreviewViewport } from "@/lib/agent/preview/snapshot";
import { storefrontPreview, type StorefrontPreviewNotes } from "@/lib/agent/preview/storefront-preview";
import { readMeasurements, type PreviewMeasurements } from "@/lib/agent/preview/targets";
import { LIVE_PREVIEW_TOKEN_SECONDS, mintPreviewToken } from "@/lib/agent/preview/token";
import { STOREFRONT_PREVIEW_VIEW_HTML } from "@/lib/agent/preview/view";
import { READ, ToolFailure, ToolMedia, defineTool } from "@/lib/agent/tool";
import { appOrigin, appUrl } from "@/lib/app-url";
import { R2_ORIGIN_SOURCE } from "@/lib/r2";
import { notFound, rateLimited } from "@/lib/errors";
import { RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { boardSummary } from "@/lib/storefront/design-ops";
import { storefrontEditorPath } from "@/lib/storefront/paths";
import { productPageUrl } from "@/lib/storefront/product-page-url";
import { getStorefront } from "@/lib/storefront/queries";

/**
 * PREVIEWS: the design as a browser draws it, for the model and, in a host with
 * MCP Apps, for the seller beside the conversation (docs/mcp-apps.md).
 */

/** What a view may reach beyond itself, as MCP Apps `_meta.ui.csp`. */
export type ViewCsp = { connectDomains?: string[]; resourceDomains?: string[] };

/**
 * The views these tools name, as the transport serves them from resources/read.
 *
 * The storefront view reads the live preview page from this app (connect) and
 * shows its markup with this app's stylesheets, fonts and photos (resources).
 * Not a nested iframe: Claude restricts `frameDomains` pending its own security
 * review, so the page's HTML is fetched and drawn in the view itself.
 */
export const PREVIEW_VIEWS: Record<
  string,
  { name: string; title: string; description: string; html: string; csp: () => ViewCsp }
> = {
  [STOREFRONT_PREVIEW_VIEW_URI]: {
    name: "storefront-preview",
    title: "Storefront preview",
    description: "A storefront on a desktop and on a phone, live, with each product tile selectable.",
    html: STOREFRONT_PREVIEW_VIEW_HTML,
    csp: () => ({ connectDomains: [appOrigin()], resourceDomains: [appOrigin(), R2_ORIGIN_SOURCE] }),
  },
};

/**
 * How much of a result the pictures for the model may take, in base64
 * characters. Claude does not open a view on a tool result past about 150,000
 * characters, so the pictures stay well under it with the words beside them; a
 * picture that does not fit is left out and said so, and the view still shows
 * the storefront live.
 */
const PICTURE_BUDGET_CHARS = 110_000;

/** The notes in plain sentences, for the model and the view alike. */
function notesInWords(notes: StorefrontPreviewNotes): string[] {
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

export const previewTools = [
  defineTool({
    name: "preview_storefront",
    title: "Preview a storefront",
    description:
      "See a storefront the way a buyer's browser draws it: screenshots from a real browser using the live storefront renderer, on a desktop (1280 wide) and on a phone (390 wide), " +
      "with where each product tile landed, and what keeps any of it from buyers (drafts, missing photos, the store not being public yet). " +
      "Use it after edit_storefront to check your work: overlaps, contrast, empty photo frames, text that does not fit, and how it reads on a phone. " +
      "Drafts are drawn, because this is the seller's own preview; buyers do not see them. In a host with MCP Apps the seller sees the same pictures and can switch screens and pick a tile. " +
      "Each call drives a browser, so use it to check a batch of edits, not every one. Up to 30 an hour.",
    scope: "store:read",
    permission: "store.read",
    annotations: READ,
    view: STOREFRONT_PREVIEW_VIEW_URI,
    enabled: agentPreviewEnabled,
    input: z.strictObject({
      id: z.string().describe("The storefront's id."),
      viewport: z.enum(["both", "desktop", "mobile"]).optional().describe("Which screens to take. Both by default."),
    }),
    handler: async ({ id, viewport = "both" }, { grantId }) => {
      // Read under row level security first: a storefront of another store is
      // not found here, before any token is minted or browser started.
      const storefront = await getStorefront(id);
      if (!storefront) throw new ToolFailure(notFound("storefront"));
      if (!(await rateLimitKey(`grant:${grantId}`, "agent_preview", RATE_LIMITS.agentPreview))) {
        throw new ToolFailure(rateLimited("agentTools"));
      }
      const preview = await storefrontPreview(id);
      if (!preview) throw new ToolFailure(notFound("storefront"));

      const wanted: PreviewViewport[] = viewport === "both" ? ["desktop", "mobile"] : [viewport];
      const token = await mintPreviewToken({ kind: "storefront", id }, grantId);
      const url = storefrontPreviewUrl(id, token);
      const shots = await Promise.all(wanted.map((screen) => takeSnapshot(url, screen)));

      const images: { data: string; mimeType: string }[] = [];
      const imageIndex: Partial<Record<PreviewViewport, number>> = {};
      const measured: Partial<Record<PreviewViewport, PreviewMeasurements>> = {};
      const tooLarge: PreviewViewport[] = [];
      let budget = PICTURE_BUDGET_CHARS;
      wanted.forEach((screen, index) => {
        const shot = shots[index];
        if (!shot) return;
        const found = readMeasurements(shot.html);
        if (found) measured[screen] = found;
        if (shot.image.length > budget) {
          tooLarge.push(screen);
          return;
        }
        budget -= shot.image.length;
        // Content block 0 is the text; the pictures follow it, in this order.
        imageIndex[screen] = 1 + images.length;
        images.push({ data: shot.image, mimeType: shot.mimeType });
      });
      // The view reads the page itself, for a quarter of an hour.
      const liveToken = await mintPreviewToken({ kind: "storefront", id }, grantId, LIVE_PREVIEW_TOKEN_SECONDS);

      const notes = notesInWords(preview.notes);
      const isPublic = preview.notes.notPublic.length === 0;
      const tilesFor = (screen: PreviewViewport) =>
        (measured[screen]?.tiles ?? []).map((tile) => ({
          ...tile,
          ...(isPublic && tile.status === "active" ? { pageUrl: productPageUrl(id, tile.productId) } : {}),
        }));

      return new ToolMedia(
        {
          storefront: { id: storefront.id, name: storefront.name },
          pictures: wanted.filter((screen) => imageIndex[screen] !== undefined),
          ...(tooLarge.length ? { picturesTooLargeToSend: tooLarge } : {}),
          ...(wanted.some((screen) => imageIndex[screen] === undefined && !tooLarge.includes(screen))
            ? { picturesMissing: wanted.filter((screen) => imageIndex[screen] === undefined && !tooLarge.includes(screen)) }
            : {}),
          notes,
          // Where each product tile was drawn, in page pixels of its picture.
          tiles: Object.fromEntries(wanted.filter((screen) => measured[screen]).map((screen) => [screen, measured[screen]])),
          board: boardSummary(storefront.config),
        },
        images,
        {
          storefront: { id: storefront.id, name: storefront.name },
          viewport: wanted[0],
          imageIndex,
          viewports: Object.fromEntries(
            wanted
              .filter((screen) => measured[screen])
              .map((screen) => [screen, { page: measured[screen]?.page, tiles: tilesFor(screen) }]),
          ),
          links: { designer: appUrl(storefrontEditorPath(id)) },
          // The page the view draws live; `vp=mobile` gives its phone board.
          live: { url: storefrontPreviewUrl(id, liveToken) },
          notes,
        },
      );
    },
  }),
];
