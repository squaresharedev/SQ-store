import { z } from "zod";
import { bytesFromImageInput, imageInputShape } from "@/lib/agent/image-input";
import { collectObjectKeys, rememberUpload, restoreObjectKeys, withholdObjectKeys } from "@/lib/agent/object-refs";
import { DESTRUCTIVE, READ, ToolFailure, WRITE, defineTool, formDataFrom, unwrap, unwrapState } from "@/lib/agent/tool";
import {
  GET as getCheckoutPageRoute,
  PATCH as patchCheckoutPageRoute,
} from "@/app/api/storefronts/[id]/checkout-page/route";
import {
  GET as getProductPageRoute,
  PATCH as patchProductPageRoute,
} from "@/app/api/storefronts/[id]/product-page/route";
import { actionError, invalidInput, notFound, rateLimited, serverError, type ActionErrorCode } from "@/lib/errors";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { saveShippingPolicy } from "@/lib/settings/shipping-actions";
import { getShippingPolicy } from "@/lib/settings/shipping-policy";
import {
  createStorefront,
  deleteStorefront,
  rotateEmbedKey,
  saveStorefront,
  updateEmbedSettings,
} from "@/lib/storefront/actions";
import { DesignOpRefused, applyDesignOps, boardSummary, designOpSchema } from "@/lib/storefront/design-ops";
import { getShippingChoices, getStorefront, listStorefronts } from "@/lib/storefront/queries";
import { storeElement } from "@/lib/uploads/store-element";
import { msg } from "@/i18n/types";
import { firstIssue } from "@/lib/validation/messages";
import { ELEMENT_MAX_BYTES, productWriteSchema } from "@/lib/validation/product";
import { shippingPolicySchema } from "@/lib/validation/shipping-policy";
import { discountInputSchema } from "@/lib/validation/discounts";
import { storefrontConfigSchema } from "@/lib/validation/storefront";

const storefrontId = z.string().describe("The storefront's id.");

/** What the schemas can be asked about. One tool, so the tool list stays small
 *  and a new contract is one line. */
const SCHEMAS = {
  storefront_config: storefrontConfigSchema,
  product: productWriteSchema,
  shipping_policy: shippingPolicySchema,
  discount: discountInputSchema,
} as const;

/**
 * A schema as an assistant should read it: the fields that take a raw storage
 * key are not ones it can write (create_product and update_product take `image`
 * instead), and the secret check would rightly refuse a document naming them.
 */
function withoutStorageFields<T>(schema: T): T {
  if (Array.isArray(schema)) return schema.map(withoutStorageFields) as T;
  if (!schema || typeof schema !== "object") return schema;
  const copy: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(schema)) {
    if (STORAGE_FIELDS.has(name)) continue;
    copy[name] =
      name === "required" && Array.isArray(value)
        ? value.filter((field) => !STORAGE_FIELDS.has(field))
        : withoutStorageFields(value);
  }
  return copy as T;
}

const STORAGE_FIELDS = new Set(["imageKey", "digitalFileKey"]);

/** A page settings route answers in the app's own error shape: pass it on. */
async function fromPageRoute(response: Response): Promise<unknown> {
  const body = (await response.json()) as { error?: { code?: string; message?: string; fix?: string } };
  if (response.ok) return body;
  const failure = body.error;
  throw new ToolFailure(
    failure?.message
      ? actionError(
          (failure.code as ActionErrorCode) ?? "unexpected",
          msg("Errors.agent.passThrough", { message: failure.message }),
          failure.fix ? msg("Errors.agent.passThrough", { message: failure.fix }) : undefined,
        )
      : serverError("agentTools"),
  );
}

function pageContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function patchRequest(id: string, body: unknown): Request {
  return new Request(`https://agent.invalid/api/storefronts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const pageSettings = z
  .record(z.string(), z.unknown())
  .describe("Only what changes. null clears an optional field back to inheriting.");

/** How many changes one edit_storefront call may make: a whole board's worth. */
const DESIGN_OPS_MAX = 200;

/** A refusal in words written for the assistant reading it. */
function refused(message: string, fix?: string): ToolFailure {
  return new ToolFailure(
    invalidInput(
      msg("Errors.agent.passThrough", { message }),
      fix ? msg("Errors.agent.passThrough", { message: fix }) : undefined,
    ),
  );
}

export const storefrontTools = [
  defineTool({
    name: "list_storefronts",
    title: "List storefronts",
    description: "The store's storefronts, most recently edited first. Use get_storefront for one in full. Never lists a sample storefront: that is not a real one.",
    scope: "store:read",
    permission: "store.read",
    annotations: READ,
    input: z.strictObject({ offset: z.number().int().min(0).optional() }),
    handler: async ({ offset }) => {
      const page = await listStorefronts(offset);
      return {
        total: page.total,
        storefronts: page.rows.map((row) => ({
          id: row.id,
          name: row.name,
          blockCount: row.blockCount,
          updatedAt: row.updatedAt,
          embedEnabled: row.config.embed?.enabled ?? false,
          ...(row.removal ? { takenDown: row.removal } : {}),
        })),
      };
    },
  }),

  defineTool({
    name: "get_storefront",
    title: "Get a storefront",
    description:
      "One storefront's whole design. Files appear as ref: handles: send them back unchanged to keep them. `version` goes back with edit_storefront or save_storefront so a seller's newer edit is not overwritten. " +
      "x/y/w/h is a block's unrotated rectangle. z is paint order only, not reading order. Blocks may overlap on purpose.",
    scope: "store:read",
    permission: "store.read",
    annotations: READ,
    input: z.strictObject({ id: storefrontId }),
    handler: async ({ id }) => {
      const storefront = await getStorefront(id);
      if (!storefront) throw new ToolFailure(notFound("storefront"));
      return {
        id: storefront.id,
        name: storefront.name,
        version: storefront.version,
        config: await withholdObjectKeys(storefront.config),
        ...(storefront.removal ? { takenDown: storefront.removal } : {}),
      };
    },
  }),

  defineTool({
    name: "get_schema",
    title: "Get a data schema",
    description: "The JSON Schema of a large input, so you can write valid values: storefront_config (what save_storefront takes), product, shipping_policy or discount.",
    scope: "store:read",
    permission: "store.read",
    annotations: READ,
    input: z.strictObject({ of: z.enum(["storefront_config", "product", "shipping_policy", "discount"]) }),
    handler: async ({ of }) =>
      withoutStorageFields(z.toJSONSchema(SCHEMAS[of], { io: "input", unrepresentable: "any" })),
  }),

  defineTool({
    name: "get_product_page",
    title: "Get product page settings",
    description: "How a storefront's hosted product pages look and which sections show. `buyButton` is what is actually painted; report that rather than a stored value, because absent means it follows the storefront.",
    scope: "store:read",
    permission: "store.read",
    annotations: READ,
    input: z.strictObject({ id: storefrontId }),
    handler: async ({ id }) =>
      fromPageRoute(await getProductPageRoute(new Request("https://agent.invalid"), pageContext(id))),
  }),

  defineTool({
    name: "get_checkout_page",
    title: "Get checkout page settings",
    description: "How a storefront's hosted checkout looks. `options` lists the values each enum field accepts. The pay button's label is fixed by law and not settable.",
    scope: "store:read",
    permission: "store.read",
    annotations: READ,
    input: z.strictObject({ id: storefrontId }),
    handler: async ({ id }) =>
      fromPageRoute(await getCheckoutPageRoute(new Request("https://agent.invalid"), pageContext(id))),
  }),

  defineTool({
    name: "get_shipping_policy",
    title: "Get shipping and returns",
    description: "The store's shipping and returns terms and its named profiles. They belong to the store, not to any one storefront.",
    scope: "store:read",
    permission: "store.read",
    annotations: READ,
    input: z.strictObject({}),
    handler: async (_input, { account }) => {
      const [policy, choices] = await Promise.all([getShippingPolicy(account.accountId), getShippingChoices()]);
      return { policy, profiles: choices.profiles };
    },
  }),

  defineTool({
    name: "create_storefront",
    title: "Create a storefront",
    description: "Make a new empty storefront and get its id. Then design it with edit_storefront.",
    scope: "storefronts:write",
    permission: "storefront.write",
    annotations: WRITE,
    input: z.strictObject({}),
    handler: async () => {
      const { id } = unwrap(await createStorefront());
      return { id };
    },
  }),

  defineTool({
    name: "edit_storefront",
    title: "Edit a storefront's design",
    description:
      "Move, resize, turn, restyle, layer, add or remove things on a storefront, in as many steps as you like: the whole list is saved together or not at all, so a refused step changes nothing. The way to change a design, because nothing you do not name is touched. " +
      "The board is theme.columns by theme.rows cells; x and y count from 0 at the top left, and blocks may overlap on purpose. Operations (`op`): " +
      "add_product, add_text, add_shape, add_image (the file is an upload_id from upload_element) place something new, on the next free cells unless you give x and y; " +
      "move (x, y), resize (w, h), rotate (clockwise degrees), layer (front, forward, backward, back), remove; " +
      "style changes a block's look with `changes`: on a shape kind, color, borderWidth, borderColor, opacity, roundness, points; on text text, variant, align, color, fontSize, font, bold, italic, underline; on an image alt, fit, opacity, imagePlacement, file; on a product tile the per-tile look such as cornerRadius, titleStyle, priceTagPosition, priceTagColor, and imagePlacement to frame its photo; " +
      "theme changes the whole board with `changes`: background ({kind:solid,color} or {kind:gradient,from,to,angle}), accent, font, columns, rows, cornerRadius, gridGap and more; header changes the store name and bio above the board. " +
      "get_schema with of=storefront_config has every field and limit. Colors are strict #rrggbb. Answers with the board as it now stands and the new `version`.",
    scope: "storefronts:write",
    permission: "storefront.write",
    annotations: WRITE,
    input: z.strictObject({
      id: storefrontId,
      operations: z.array(designOpSchema).min(1).max(DESIGN_OPS_MAX),
      version: z
        .string()
        .max(200)
        .optional()
        .describe("From get_storefront or the last edit. If the seller has saved since, this refuses rather than overwriting them."),
    }),
    handler: async ({ id, operations, version }, { grantId }) => {
      const current = await getStorefront(id);
      if (!current) throw new ToolFailure(notFound("storefront"));
      const operationsWithFiles = await restoreObjectKeys(operations, collectObjectKeys(current.config), grantId);
      let edited;
      try {
        edited = applyDesignOps(current.config, operationsWithFiles);
      } catch (error) {
        if (error instanceof DesignOpRefused) throw refused(error.message, error.fix);
        throw error;
      }
      const parsed = storefrontConfigSchema.safeParse(edited.config);
      if (!parsed.success) {
        const offBoard = parsed.error.issues.some((issue) => issue.path[0] === "blocks");
        const { columns, rows } = edited.config.theme;
        throw new ToolFailure(
          invalidInput(
            firstIssue(parsed.error),
            offBoard
              ? msg("Errors.agent.passThrough", {
                  message: `The board is ${columns} by ${rows} cells: x + w may reach ${columns} and y + h may reach ${rows}. A theme operation in the same list can make it bigger.`,
                })
              : undefined,
          ),
        );
      }
      // Always compared: the board was just read, and a seller's save landing
      // between that read and this write must not be overwritten by it.
      const saved = unwrap(
        await saveStorefront(id, { name: current.name, config: edited.config }, { expectedVersion: version ?? current.version }),
      );
      return {
        id,
        version: "version" in saved ? saved.version : undefined,
        added: edited.added,
        board: boardSummary(parsed.data),
      };
    },
  }),

  defineTool({
    name: "upload_element",
    title: "Upload artwork for a storefront",
    description:
      "Store a logo, icon or graphic (SVG, or an image up to 2 MB) and get an upload_id to place with add_image in edit_storefront. From a public HTTPS URL, or base64. An SVG carrying script or outside references is refused, and every SVG waits for a person to check it before buyers see it. An upload_id lasts 24 hours.",
    scope: "storefronts:write",
    permission: "storefront.write",
    annotations: { ...WRITE, openWorldHint: true },
    input: z.strictObject(imageInputShape),
    handler: async (input, { account, grantId }) => {
      if (!input.url && !input.base64) {
        throw new ToolFailure(invalidInput(msg("Errors.agent.imageUnreadable"), msg("Errors.agent.imageUnreadableFix")));
      }
      if (!(await rateLimit("upload_presign", RATE_LIMITS.uploadPresign))) {
        throw new ToolFailure(rateLimited("agentTools"));
      }
      const bytes = await bytesFromImageInput(input, ELEMENT_MAX_BYTES);
      if (!bytes) {
        throw new ToolFailure(invalidInput(msg("Errors.agent.imageUnreadable"), msg("Errors.agent.imageUnreadableFix")));
      }
      const stored = await storeElement(bytes, input.filename, account.userId);
      if (!stored.ok) {
        if (stored.reason === "store_failed" || stored.reason === "moderation_unavailable") {
          throw new ToolFailure(serverError("agentTools"));
        }
        throw refused(
          "That file cannot be used as artwork.",
          "Send an SVG with no script or outside references, or a JPEG, PNG, WebP, GIF or AVIF, within 2 MB.",
        );
      }
      const uploadId = await rememberUpload({ grantId, kind: "element", objectKey: stored.key });
      if (!uploadId) throw new ToolFailure(serverError("agentTools"));
      return { uploadId };
    },
  }),

  defineTool({
    name: "save_storefront",
    title: "Save a storefront",
    description:
      "Rename a storefront, or replace whole parts of its design. To change things on a board use edit_storefront instead: here `blocks` is replaced whole, so anything left out is gone. Send only the top-level config members you are changing: theme, header, blocks and so on, each replaced whole, the rest kept. Call get_schema with of=storefront_config for what is valid. " +
      "Pass the version from get_storefront: if the seller has saved since, this refuses rather than overwriting them, so read it again. A product block must name a product of this store. New photos go in as upload_id values from upload_image.",
    scope: "storefronts:write",
    permission: "storefront.write",
    annotations: WRITE,
    input: z.strictObject({
      id: storefrontId,
      name: z.string().max(200).optional(),
      config: z.record(z.string(), z.unknown()).optional(),
      version: z.string().max(200).optional(),
    }),
    handler: async ({ id, name, config, version }, { grantId }) => {
      const current = await getStorefront(id);
      if (!current) throw new ToolFailure(notFound("storefront"));
      // Only what the assistant sent goes through the handles: the stored config
      // holds real keys, which the check for a raw key would rightly refuse.
      const incoming = await restoreObjectKeys(config ?? {}, collectObjectKeys(current.config), grantId);
      const merged = { ...current.config, ...incoming };
      const parsed = storefrontConfigSchema.safeParse(merged);
      if (!parsed.success) throw new ToolFailure(invalidInput(firstIssue(parsed.error)));
      const saved = unwrap(
        await saveStorefront(id, { name: name ?? current.name, config: merged }, { expectedVersion: version }),
      );
      return { id, version: "version" in saved ? saved.version : undefined };
    },
  }),

  defineTool({
    name: "update_product_page",
    title: "Update product page settings",
    description: "Change a storefront's hosted product page. Send only what changes. Photos cannot be set here, only cleared with null.",
    scope: "storefronts:write",
    permission: "storefront.write",
    annotations: WRITE,
    input: z.strictObject({ id: storefrontId, settings: pageSettings }),
    handler: async ({ id, settings }) =>
      fromPageRoute(await patchProductPageRoute(patchRequest(id, settings), pageContext(id))),
  }),

  defineTool({
    name: "update_checkout_page",
    title: "Update checkout page settings",
    description: "Change a storefront's hosted checkout. Send only what changes. Words here sit beside a payment, so links, email addresses and bank details are refused.",
    scope: "storefronts:write",
    permission: "storefront.write",
    annotations: WRITE,
    input: z.strictObject({ id: storefrontId, settings: pageSettings }),
    handler: async ({ id, settings }) =>
      fromPageRoute(await patchCheckoutPageRoute(patchRequest(id, settings), pageContext(id))),
  }),

  defineTool({
    name: "update_embed_settings",
    title: "Update embed settings",
    description: "Switch a storefront's website embed on or off and set which domains may show it. Switching on can be refused with trader_identity_required, which only the seller can fix.",
    scope: "storefronts:write",
    permission: "storefront.write",
    annotations: WRITE,
    input: z.strictObject({
      id: storefrontId,
      enabled: z.boolean(),
      domains: z.array(z.string().max(255)).max(50),
    }),
    handler: async ({ id, enabled, domains }) => {
      unwrap(await updateEmbedSettings(id, { enabled, domains }));
      return { ok: true };
    },
  }),

  defineTool({
    name: "save_shipping_policy",
    title: "Save shipping and returns",
    description: "Replace the store's shipping and returns terms. Read them with get_shipping_policy first, change what is needed, send the whole thing. See get_schema with of=shipping_policy.",
    scope: "storefronts:write",
    permission: "storefront.write",
    ownerOnly: true,
    annotations: WRITE,
    input: z.strictObject({ policy: z.record(z.string(), z.unknown()) }),
    handler: async ({ policy }) => {
      const parsed = shippingPolicySchema.safeParse(policy);
      if (!parsed.success) throw new ToolFailure(invalidInput(firstIssue(parsed.error)));
      return unwrapState(await saveShippingPolicy({}, formDataFrom({ policy: JSON.stringify(policy) })));
    },
  }),

  defineTool({
    name: "delete_storefront",
    title: "Delete a storefront",
    description: "Delete a storefront. This cannot be undone, and any website embedding it stops showing it. Confirm with the seller first.",
    scope: "destructive",
    permission: "storefront.write",
    annotations: DESTRUCTIVE,
    input: z.strictObject({ id: storefrontId }),
    handler: async ({ id }) => {
      unwrap(await deleteStorefront(id));
      return { ok: true };
    },
  }),

  defineTool({
    name: "rotate_embed_key",
    title: "Rotate an embed key",
    description:
      "Replace a storefront's embed key. Every website using the old snippet stops working until it is updated, so confirm with the seller first. The new key is never returned here: the seller copies the new snippet from the storefront's embed page.",
    scope: "destructive",
    permission: "storefront.write",
    annotations: DESTRUCTIVE,
    input: z.strictObject({ id: storefrontId }),
    handler: async ({ id }) => {
      unwrap(await rotateEmbedKey(id));
      return { ok: true };
    },
  }),
];
