import { z } from "zod";
import { toEnvelope, type ToolErrorEnvelope } from "@/lib/agent/dispatch";
import { bytesFromImageInput, imageInputShape } from "@/lib/agent/image-input";
import { collectObjectKeys, rememberUpload, restoreObjectKeys } from "@/lib/agent/object-refs";
import { PUBLISH_CARD_VIEW_URI } from "@/lib/agent/paths";
import { presentProduct, presentProductDetail } from "@/lib/agent/present";
import { DESTRUCTIVE, READ, ToolFailure, ToolMedia, WRITE, defineTool, unwrap } from "@/lib/agent/tool";
import { appUrl } from "@/lib/app-url";
import { getProductsSummary } from "@/lib/dashboard/queries";
import { invalidInput, notFound, rateLimited, serverError } from "@/lib/errors";
import { formatCents } from "@/lib/format/money";
import { DEFAULT_LOCALE } from "@/i18n/locales";
import { msg } from "@/i18n/types";
import { checkBadgeLabel, moveProductBadge } from "@/lib/products/badge-actions";
import { createProduct, deleteProduct, updateProduct } from "@/lib/products/actions";
import { importProducts } from "@/lib/products/import-actions";
import { productEditPath } from "@/lib/products/paths";
import { getProduct, getProductPlacements, getProductSales, listProducts } from "@/lib/products/queries";
import { PRODUCT_SORTS } from "@/lib/products/sort";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { updateStockSettings } from "@/lib/stock/actions";
import { resolveProductPage } from "@/lib/storefront/product-page";
import { productPageUrl } from "@/lib/storefront/product-page-url";
import { getStorefront } from "@/lib/storefront/queries";
import { storeImage } from "@/lib/uploads/store-image";
import { firstIssue } from "@/lib/validation/messages";
import { IMAGE_MAX_BYTES, productWriteSchema } from "@/lib/validation/product";
import { CURRENCIES, PRODUCT_STATUSES } from "@/types/product";

const IMAGE_URL_NOTE = "imageUrl is a signed link that expires within hours: show it, never store it.";

/** How many products one publish_products call may put on sale. */
const PUBLISH_BATCH_MAX = 20;

/** Said of a product that went live without a storefront to be found on. */
const NO_STOREFRONT_NOTE = "On sale, but on no storefront yet, so buyers have no way to it. Add it to one with edit_storefront.";

/** The first item `test` says yes to, asked one at a time, in order. */
async function firstAsync<T>(items: readonly T[], test: (item: T) => Promise<boolean>): Promise<T | undefined> {
  for (const item of items) if (await test(item)) return item;
  return undefined;
}

const productId = z.string().describe("The product's id.");

/** The fields a write may set, beyond the identity ones. Deep shapes are left
 *  loose here so the tool list stays small: get_schema describes them, and
 *  productWriteSchema judges every write and names the field it refuses. */
const productFields = {
  description: z.string().max(5000).optional(),
  image: z
    .string()
    .nullable()
    .optional()
    .describe("The main photo: an upload_id from upload_image, or null to remove it. Leave out to keep it."),
  gallery: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe("Extra photos, replaced whole. Each {key, alt?, optionId?}, where key is a ref: from get_product or an upload_id."),
  trackStock: z.boolean().optional(),
  stockQuantity: z.number().int().min(0).nullable().optional(),
  lowStockThreshold: z.number().int().min(0).optional(),
  maxPerOrder: z.number().int().min(1).optional(),
  optionGroups: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe("The axes it varies along, replaced whole. See get_schema with of=product. Options carry no price or stock of their own."),
  details: z.record(z.string(), z.unknown()).optional().describe("Dimensions, weight, materials, specs and so on. See get_schema with of=product."),
  purchaseUrl: z.string().nullable().optional().describe("Where the buy button goes. HTTPS only."),
  shippingProfileId: z.string().nullable().optional(),
  addOnIds: z.array(z.string()).max(4).optional().describe("Other products of this store offered beside this one. At most 4."),
};

/** The agent's words for a write, in the shape productWriteSchema reads. */
type ProductFieldsInput = {
  image?: string | null;
  [key: string]: unknown;
};

function toWriteShape({ image, ...rest }: ProductFieldsInput) {
  return { ...rest, ...(image !== undefined ? { imageKey: image } : {}) };
}

/** Judge a write here so a refusal names the field, then let the action act. */
function assertValidWrite(write: unknown): void {
  const parsed = productWriteSchema.safeParse(write);
  if (!parsed.success) throw new ToolFailure(invalidInput(firstIssue(parsed.error)));
}

export const productTools = [
  defineTool({
    name: "list_products",
    title: "List products",
    description: `The store's products, drafts included, newest first by default. Prices are integer cents. ${IMAGE_URL_NOTE}`,
    scope: "store:read",
    permission: "store.read",
    annotations: READ,
    input: z.strictObject({
      search: z.string().max(200).optional().describe("Part of a title."),
      status: z.enum(PRODUCT_STATUSES).optional(),
      sort: z.enum(PRODUCT_SORTS).optional(),
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).max(100).optional(),
    }),
    handler: async ({ search, status, sort, page, pageSize }) => {
      const list = await listProducts({ filters: { search, status }, sort, page, pageSize });
      return {
        products: list.rows.map(presentProduct),
        total: list.total,
        page: list.page,
        pageSize: list.pageSize,
      };
    },
  }),

  defineTool({
    name: "get_product",
    title: "Get a product",
    description:
      `One product in full, and which storefronts it sits on. Files appear as ref: handles: send one back unchanged to keep that file. ${IMAGE_URL_NOTE} ` +
      "An option's details are what THAT version changes; absent means it inherits the product's. Options have no price or stock, so never report one.",
    scope: "store:read",
    permission: "store.read",
    annotations: READ,
    input: z.strictObject({ id: productId }),
    handler: async ({ id }) => {
      const product = await getProduct(id);
      if (!product) throw new ToolFailure(notFound("product"));
      const placements = await getProductPlacements();
      return {
        ...(await presentProductDetail(product)),
        storefronts: (placements[id] ?? []).map(({ id: storefrontId, name }) => ({ id: storefrontId, name })),
      };
    },
  }),

  defineTool({
    name: "get_products_summary",
    title: "Get products summary",
    description: "How many products there are and which have no photo: a concrete list of things to fix.",
    scope: "store:read",
    permission: "store.read",
    annotations: READ,
    input: z.strictObject({}),
    handler: async () => {
      const summary = await getProductsSummary();
      return {
        total: summary.total,
        missingImage: summary.missingImage,
        activeWithoutBuyPath: summary.noBuyPathCount,
      };
    },
  }),

  defineTool({
    name: "get_product_sales",
    title: "Get sales by product",
    description: "Units sold and revenue per product, and the best seller. Revenue is integer cents.",
    scope: "store:read",
    permission: "store.read",
    annotations: READ,
    input: z.strictObject({}),
    handler: async () => getProductSales(),
  }),

  defineTool({
    name: "create_product",
    title: "Create a product",
    description:
      "Add a product. Keep it as a draft unless the seller asked to publish (then publish_products, which shows them what went live): setting status to active is refused with trader_identity_required until the seller's legal details are complete, and that is theirs to fix, so stay in draft and tell them.",
    scope: "products:write",
    permission: "products.write",
    annotations: WRITE,
    input: z.strictObject({
      title: z.string().max(200),
      priceCents: z.number().int().min(1).describe("Integer cents: 1250 is 12.50."),
      currency: z.enum(CURRENCIES),
      status: z.enum(PRODUCT_STATUSES).default("draft"),
      ...productFields,
    }),
    handler: async (input, { grantId }) => {
      const write = await restoreObjectKeys(
        { description: "", ...toWriteShape(input) },
        [],
        grantId,
      );
      assertValidWrite(write);
      const { id } = unwrap(await createProduct(write));
      return { id };
    },
  }),

  defineTool({
    name: "update_product",
    title: "Update a product",
    description:
      "Change a product. Send only what changes: everything left out stays as it is. Lists (gallery, optionGroups, addOnIds) are replaced whole. To put products on sale prefer publish_products, which shows the seller what went live. Setting status to active can be refused with trader_identity_required, which only the seller can fix.",
    scope: "products:write",
    permission: "products.write",
    annotations: WRITE,
    input: z.strictObject({
      id: productId,
      title: z.string().max(200).optional(),
      priceCents: z.number().int().min(1).optional(),
      currency: z.enum(CURRENCIES).optional(),
      status: z.enum(PRODUCT_STATUSES).optional(),
      ...productFields,
    }),
    handler: async ({ id, ...input }, { grantId }) => {
      const current = await getProduct(id);
      if (!current) throw new ToolFailure(notFound("product"));
      const write = await restoreObjectKeys(
        {
          title: current.title,
          description: current.description,
          priceCents: Math.round(current.price * 100),
          currency: current.currency,
          status: current.status,
          ...toWriteShape(input),
        },
        collectObjectKeys([current.gallery, current.documents, current.optionGroups, current.details]),
        grantId,
      );
      assertValidWrite(write);
      unwrap(await updateProduct(id, write));
      return { id };
    },
  }),

  defineTool({
    name: "publish_products",
    title: "Publish products",
    description:
      "Put products on sale: each goes from draft or archived to active, so buyers can see and buy it on every storefront it is on. Only when the seller has asked to publish. " +
      "Each product is published or refused on its own and the answer says which. A refusal carries its reason and fix: trader_identity_required means the seller's legal details are not complete, which only they can do, so pass on its link. " +
      `A product on no storefront goes live with no way to it yet, and the answer says so. At most ${PUBLISH_BATCH_MAX} at once. In a host with MCP Apps the seller sees a card of what went live, with each page, and what did not.`,
    scope: "products:write",
    permission: "products.write",
    annotations: WRITE,
    view: PUBLISH_CARD_VIEW_URI,
    input: z.strictObject({
      ids: z.array(productId).min(1).max(PUBLISH_BATCH_MAX).describe("The products to put on sale."),
    }),
    handler: async ({ ids }) => {
      const placements = await getProductPlacements();
      const storefronts = new Map<string, Promise<boolean>>();
      // Whether a buyer can open product pages there at all.
      const pagesOpen = (storefrontId: string) => {
        if (!storefronts.has(storefrontId)) {
          storefronts.set(
            storefrontId,
            getStorefront(storefrontId).then((record) => Boolean(record && !record.removal && resolveProductPage(record.config).enabled)),
          );
        }
        return storefronts.get(storefrontId)!;
      };

      const results: {
        id: string;
        outcome: "published" | "already_live" | "refused" | "not_found";
        current?: NonNullable<Awaited<ReturnType<typeof getProduct>>>;
        error?: ToolErrorEnvelope;
        pageUrl?: string;
        note?: string;
      }[] = [];
      // One at a time, in the order asked: each is the same write the product form makes.
      for (const id of new Set(ids)) {
        const current = await getProduct(id);
        if (!current) {
          results.push({ id, outcome: "not_found", error: await toEnvelope(notFound("product")) });
          continue;
        }
        let outcome: "published" | "already_live" | "refused" = "already_live";
        let error: ToolErrorEnvelope | undefined;
        if (current.status !== "active") {
          const write = {
            title: current.title,
            description: current.description,
            priceCents: Math.round(current.price * 100),
            currency: current.currency,
            status: "active",
          };
          assertValidWrite(write);
          const result = await updateProduct(id, write);
          if (result.ok) outcome = "published";
          else {
            outcome = "refused";
            error = await toEnvelope(result.error);
          }
        }
        const on = placements[id] ?? [];
        const open = outcome === "refused" ? undefined : await firstAsync(on, (spot) => pagesOpen(spot.id));
        results.push({
          id,
          outcome,
          current,
          ...(error ? { error } : {}),
          ...(open ? { pageUrl: productPageUrl(open.id, id) } : {}),
          ...(outcome !== "refused" && on.length === 0 ? { note: NO_STOREFRONT_NOTE } : {}),
        });
      }

      return new ToolMedia(
        {
          products: results.map(({ id, outcome, current, error, pageUrl, note }) => ({
            id,
            ...(current ? { title: current.title } : {}),
            outcome,
            ...(pageUrl ? { pageUrl } : {}),
            ...(note ? { note } : {}),
            ...(error ? { error } : {}),
          })),
        },
        [],
        {
          kind: "publish",
          items: results.map(({ id, outcome, current, error, pageUrl, note }) => ({
            id,
            title: current?.title ?? id,
            outcome,
            ...(current
              ? {
                  price: formatCents(Math.round(current.price * 100), current.currency, DEFAULT_LOCALE),
                  imageUrl: current.imageUrl,
                  editUrl: appUrl(productEditPath(id)),
                }
              : {}),
            ...(pageUrl ? { pageUrl } : {}),
            ...(error || note ? { reason: error ? (error.fix ?? error.message) : note } : {}),
            ...(error?.action ? { fix: { label: error.action.label, url: error.action.href } } : {}),
          })),
        },
      );
    },
  }),

  defineTool({
    name: "import_products",
    title: "Import products from CSV",
    description:
      "Create many products from CSV text. `columns` maps title, description, price, sku and stock to zero-based column numbers. Prefer status draft, so the seller can check them before they go on sale.",
    scope: "products:write",
    permission: "products.write",
    annotations: WRITE,
    input: z.strictObject({
      csv: z.string().max(3_000_000),
      columns: z.record(z.string(), z.number().int().min(0).nullable()),
      currency: z.enum(CURRENCIES),
      status: z.enum(PRODUCT_STATUSES).default("draft"),
    }),
    handler: async (input) => {
      const result = unwrap(await importProducts(input));
      return result;
    },
  }),

  defineTool({
    name: "update_stock",
    title: "Update stock",
    description: "Set a product's stock as an ABSOLUTE count, not a change. trackStock false means unlimited. stockQuantity is required while tracking.",
    scope: "products:write",
    permission: "products.write",
    annotations: { ...WRITE, idempotentHint: true },
    input: z.strictObject({
      id: productId,
      trackStock: z.boolean(),
      stockQuantity: z.number().int().min(0).nullable().optional(),
      lowStockThreshold: z.number().int().min(0),
    }),
    handler: async ({ id, ...settings }) => {
      unwrap(await updateStockSettings(id, settings));
      return { ok: true };
    },
  }),

  defineTool({
    name: "check_badge_label",
    title: "Check a badge label",
    description: "Whether a label would be accepted on a product badge, before you save it.",
    scope: "products:write",
    permission: "products.write",
    annotations: { readOnlyHint: true, idempotentHint: true },
    input: z.strictObject({ label: z.string().max(100) }),
    handler: async ({ label }) => unwrap(await checkBadgeLabel(label)),
  }),

  defineTool({
    name: "move_product_badge",
    title: "Move a product badge",
    description: "Place one of a product's badges beside the title or on the photo (at most 3 on the photo).",
    scope: "products:write",
    permission: "products.write",
    annotations: WRITE,
    input: z.strictObject({
      id: productId,
      label: z.string().max(100),
      placement: z.string().max(40),
    }),
    handler: async ({ id, label, placement }) => {
      unwrap(await moveProductBadge(id, label, placement));
      return { ok: true };
    },
  }),

  defineTool({
    name: "upload_image",
    title: "Upload an image",
    description:
      "Store an image and get an upload_id, which create_product, update_product and save_storefront accept wherever a photo goes. From a public HTTPS URL, or base64 for small files. It goes through the same automatic check as a dashboard upload. An upload_id lasts 24 hours.",
    scope: "products:write",
    permission: "products.write",
    annotations: { ...WRITE, openWorldHint: true },
    input: z.strictObject(imageInputShape),
    handler: async (input, { account, grantId }) => {
      if (!input.url && !input.base64) {
        throw new ToolFailure(invalidInput(msg("Errors.agent.imageUnreadable"), msg("Errors.agent.imageUnreadableFix")));
      }
      if (!(await rateLimit("upload_presign", RATE_LIMITS.uploadPresign))) {
        throw new ToolFailure(rateLimited("agentTools"));
      }
      const bytes = await bytesFromImageInput(input, IMAGE_MAX_BYTES);
      if (!bytes) {
        throw new ToolFailure(invalidInput(msg("Errors.agent.imageUnreadable"), msg("Errors.agent.imageUnreadableFix")));
      }
      const stored = await storeImage(bytes, input.filename, account.userId);
      if (!stored.ok) {
        if (stored.reason === "store_failed" || stored.reason === "moderation_unavailable") {
          throw new ToolFailure(serverError("agentTools"));
        }
        throw new ToolFailure(invalidInput(msg("Errors.agent.imageUnreadable"), msg("Errors.agent.imageUnreadableFix")));
      }
      const uploadId = await rememberUpload({ grantId, kind: "image", objectKey: stored.key });
      if (!uploadId) throw new ToolFailure(serverError("agentTools"));
      return { uploadId };
    },
  }),

  defineTool({
    name: "delete_product",
    title: "Delete a product",
    description:
      "Delete a product. This cannot be undone. If it has orders still to ship, this refuses with how many: pass that number as acknowledgedToShip only after the seller has said to go ahead.",
    scope: "destructive",
    permission: "products.write",
    annotations: DESTRUCTIVE,
    input: z.strictObject({
      id: productId,
      acknowledgedToShip: z.number().int().min(0).default(0),
    }),
    handler: async ({ id, acknowledgedToShip }) => {
      const result = await deleteProduct(id, acknowledgedToShip);
      return unwrap(result);
    },
  }),
];
