import { z } from "zod";
import {
  boundedInt,
  emailAddress,
  hexColor,
  multiLineText,
  singleLineText,
  uuidField,
} from "@/lib/validation/inputs";
import {
  CURRENCIES,
  DIMENSION_UNITS,
  DOCUMENT_LABEL_MAX,
  DOCUMENTS_MAX,
  GALLERY_ALT_MAX,
  GALLERY_MAX,
  INCLUDED_MAX,
  OPTION_DISPLAYS,
  OPTION_GROUP_NAME_MAX,
  OPTION_GROUPS_MAX,
  OPTION_NAME_MAX,
  OPTIONS_PER_GROUP_MAX,
  OPTIONS_TOTAL_MAX,
  PRODUCT_STATUSES,
  SPECS_MAX,
  WEIGHT_UNITS,
} from "@/types/product";

// Zod schemas shared by client (UX feedback) and server (the security
// boundary). Every product write and every presign request is parsed with
// these on the server before anything touches the DB or R2 — the client-side
// checks in ProductForm/ImageDropzone are convenience only.

export const UPLOAD_KINDS = ["image", "file", "font", "element", "document"] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export const DIGITAL_FILE_MAX_BYTES = 200 * 1024 * 1024; // 200 MB
/**
 * A manual, certificate or spec sheet attached to a product.
 *
 * ITS OWN KIND, not a digital file, and the difference is the security case
 * for the whole thing. A digital file is what a buyer PAYS for: one per
 * product, 200 MB, a broad allowlist, never served without the purchase path.
 * A document is PUBLIC and unconditional: every product page presigns and
 * offers up to DOCUMENTS_MAX of them to anyone who opens the URL. Sharing the
 * file kind meant a public, unauthenticated surface inherited a 200 MB cap and
 * a twelve-type allowlist it has no use for, so eight documents on one product
 * could put 1.6 GB of arbitrary binary behind a link a crawler will follow.
 *
 * 20 MB is generous for the real thing: a scanned 40-page conformity
 * certificate at 300 dpi lands around 8 MB.
 */
export const DOCUMENT_MAX_BYTES = 20 * 1024 * 1024; // 20 MB
/**
 * Decorative artwork a seller drops on the storefront canvas: a logo, an icon,
 * a graphic. Deliberately far tighter than a product photo — an element is
 * chrome, not the subject, and every buyer who loads the storefront fetches it.
 */
export const ELEMENT_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
/**
 * Fonts are small by nature: a subset WOFF2 is tens of KB and a full-coverage
 * TTF rarely passes 1 MB. The cap is deliberately tight, because this file is fetched
 * by every buyer who loads the storefront, so a font big enough to be felt is a
 * font the seller should be compressing instead.
 */
export const FONT_MAX_BYTES = 2 * 1024 * 1024; // 2 MB

export const IMAGE_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

// What a buyer downloads: archives, documents, audio, video, images.
// Windows browsers report zips as x-zip-compressed, so both are listed.
export const DIGITAL_FILE_CONTENT_TYPES = [
  "application/zip",
  "application/x-zip-compressed",
  "application/pdf",
  "application/epub+zip",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "video/mp4",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
] as const;

/**
 * PDF AND NOTHING ELSE.
 *
 * A document is opened by whoever follows the link, in their own browser, from
 * our signed URL, so the format has to be one every reader already handles
 * safely in a sandboxed viewer. PDF is that format, it is what certificates,
 * manuals and data sheets are actually issued as, and it has a magic number
 * (`%PDF`) the upload route can check the bytes against. Nothing in the list
 * is a judgement call, which is the property to keep: an allowlist of one
 * cannot drift.
 */
export const DOCUMENT_CONTENT_TYPES = ["application/pdf"] as const;

/**
 * Web font formats a storefront may use. WOFF2 first because it is the one to
 * use: it is the smallest and every browser this app supports reads it. The
 * others are accepted so a seller with only a TTF/OTF licence is not stuck.
 */
export const FONT_CONTENT_TYPES = [
  "font/woff2",
  "font/woff",
  "font/ttf",
  "font/otf",
] as const;

/**
 * Canvas elements: every raster a product image may be, PLUS SVG.
 *
 * SVG IS ADMITTED HERE AND NOWHERE ELSE, and that isolation is the point. It is
 * markup, so it is the one upload in this product that could carry script, and
 * confining it to its own kind (and its own `elements/` prefix) means product
 * images, backgrounds, fonts and digital files keep exactly the allowlists they
 * had. Two things make it safe to accept at all: `sniffSvg` rejects any file
 * carrying script, event handlers, external references or entity declarations
 * before it is ever stored, and ImageTileContent renders elements only through
 * `<img src>`, where the spec puts SVG in secure static mode — no scripts, no
 * external fetches, no interactivity. It is never inlined into the DOM.
 */
export const ELEMENT_CONTENT_TYPES = [
  ...IMAGE_CONTENT_TYPES,
  "image/svg+xml",
] as const;

/** Max stored-object size for a kind — the cap enforced server-side via HEAD. */
export function maxBytesForKind(kind: UploadKind): number {
  switch (kind) {
    case "image":
      return IMAGE_MAX_BYTES;
    case "font":
      return FONT_MAX_BYTES;
    case "file":
      return DIGITAL_FILE_MAX_BYTES;
    case "element":
      return ELEMENT_MAX_BYTES;
    case "document":
      return DOCUMENT_MAX_BYTES;
  }
}

/** The allowlist of stored Content-Types for a kind. */
function contentTypesForKind(kind: UploadKind): readonly string[] {
  switch (kind) {
    case "image":
      return IMAGE_CONTENT_TYPES;
    case "font":
      return FONT_CONTENT_TYPES;
    case "file":
      return DIGITAL_FILE_CONTENT_TYPES;
    case "element":
      return ELEMENT_CONTENT_TYPES;
    case "document":
      return DOCUMENT_CONTENT_TYPES;
  }
}

/**
 * Whether a stored object's Content-Type is allowed for the kind. R2 returns
 * the type verbatim; tolerate an optional `; charset=...` suffix.
 */
export function isAllowedContentType(
  kind: UploadKind,
  contentType: string | null,
): boolean {
  if (!contentType) return false;
  const bare = contentType.split(";")[0]!.trim().toLowerCase();
  return contentTypesForKind(kind).includes(bare);
}

// A user-supplied file NAME (the stored key is server-minted separately).
const filenameSchema = singleLineText({ label: "A filename", max: 200 });

export const presignRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("image"),
    filename: filenameSchema,
    contentType: z.enum(IMAGE_CONTENT_TYPES),
    size: z.number().int().positive().max(IMAGE_MAX_BYTES),
  }),
  z.object({
    kind: z.literal("file"),
    filename: filenameSchema,
    contentType: z.enum(DIGITAL_FILE_CONTENT_TYPES),
    size: z.number().int().positive().max(DIGITAL_FILE_MAX_BYTES),
  }),
]);
export type PresignRequest = z.infer<typeof presignRequestSchema>;

// €/$1,000,000 cap in cents — far below int4 max, sane for the product.
export const PRICE_CENTS_MAX = 100_000_000;

// Inventory cap — far below int4 max; nobody hand-tracks more units than this.
export const STOCK_QUANTITY_MAX = 1_000_000;

// ── Product page detail (gallery, options, details, purchase link) ─────
//
// Stored as jsonb on the row. Every object is `strictObject` so nothing rides
// along in the blob, every string comes from an inputs.ts primitive, and every
// list is capped. The DB adds a byte-size CHECK per column as a second fence.

/** How many NEW gallery keys one save may introduce; mirrors the storefront's
 *  cap on new element keys so a single request cannot fan out into a pile of
 *  R2 HEAD checks. */
export const NEW_GALLERY_KEYS_PER_SAVE_MAX = GALLERY_MAX;

export const galleryImageSchema = z.strictObject({
  // Shape-checked here; ownership is checked in the action, like imageKey.
  key: z.string().max(600),
  alt: singleLineText({ label: "Alt text", max: GALLERY_ALT_MAX, min: 0 }),
  optionId: uuidField("That option").optional(),
});

export const productOptionSchema = z.strictObject({
  id: uuidField("That option"),
  name: singleLineText({ label: "An option name", max: OPTION_NAME_MAX }),
  swatch: hexColor("Swatch colours").optional(),
  available: z.boolean(),
});

/**
 * One axis a product varies along. A group with no options is refused rather
 * than tolerated: it would print an empty picker on the page, and the form
 * never produces one.
 */
export const optionGroupSchema = z.strictObject({
  id: uuidField("That option group"),
  name: singleLineText({ label: "An option group name", max: OPTION_GROUP_NAME_MAX }),
  display: z.enum(OPTION_DISPLAYS),
  options: z
    .array(productOptionSchema)
    .min(1, "Give every option group at least one option, or remove the group.")
    .max(OPTIONS_PER_GROUP_MAX, `An option group can have up to ${OPTIONS_PER_GROUP_MAX} options.`),
});

/** The structural minimum both the parsed shape and the app type satisfy, so
 *  the id helpers below work on either without a cast. */
type OptionTree = readonly { readonly id: string; readonly options: readonly { readonly id: string }[] }[];

/** Every option id in a product's groups. The set a photo tie, a `?o=` value
 *  and the picker's selection are all checked against. */
export function collectOptionIds(groups: OptionTree): Set<string> {
  const ids = new Set<string>();
  for (const group of groups) for (const option of group.options) ids.add(option.id);
  return ids;
}

/** True when no id repeats anywhere in the tree — group ids and option ids
 *  share one space, because a group is addressable too (the URL orders its
 *  values by group) and an id that means two things means neither. */
export function uniqueOptionTreeIds(groups: OptionTree): boolean {
  const seen = new Set<string>();
  for (const group of groups) {
    if (seen.has(group.id)) return false;
    seen.add(group.id);
    for (const option of group.options) {
      if (seen.has(option.id)) return false;
      seen.add(option.id);
    }
  }
  return true;
}

/** How many NEW document keys one save may introduce — same reasoning as
 *  NEW_GALLERY_KEYS_PER_SAVE_MAX, one R2 HEAD check per new key. */
export const NEW_DOCUMENT_KEYS_PER_SAVE_MAX = DOCUMENTS_MAX;

/** A certificate, manual or spec sheet. `key` is shape-checked here; ownership
 *  (against the uploader) is checked in the action, like digitalFileKey. */
export const documentSchema = z.strictObject({
  key: z.string().max(600),
  label: singleLineText({ label: "A document name", max: DOCUMENT_LABEL_MAX }),
});

/** A physical measure: non-negative, sane upper bound, no NaN or infinities
 *  (Zod 4's number already refuses those). */
const measure = z.number().min(0).max(100_000);

export const productDetailsSchema = z.strictObject({
  dimensions: z
    .strictObject({
      length: measure.optional(),
      width: measure.optional(),
      height: measure.optional(),
      unit: z.enum(DIMENSION_UNITS),
    })
    .optional(),
  weight: z
    .strictObject({ value: measure, unit: z.enum(WEIGHT_UNITS) })
    .optional(),
  materials: multiLineText({ label: "Materials", max: 300 }).optional(),
  care: multiLineText({ label: "Care instructions", max: 1000 }).optional(),
  included: z
    .array(singleLineText({ label: "An included item", max: 120 }))
    .max(INCLUDED_MAX, `List up to ${INCLUDED_MAX} included items.`)
    .optional(),
  specs: z
    .array(
      z.strictObject({
        label: singleLineText({ label: "A specification name", max: 40 }),
        value: singleLineText({ label: "A specification value", max: 200 }),
      }),
    )
    .max(SPECS_MAX, `List up to ${SPECS_MAX} specifications.`)
    .optional(),
  origin: singleLineText({ label: "Country of origin", max: 60 }).optional(),
  safety: z
    .strictObject({
      manufacturerName: singleLineText({ label: "The manufacturer", max: 120 }),
      manufacturerAddress: multiLineText({
        label: "The manufacturer's address",
        max: 300,
        min: 1,
      }),
      manufacturerEmail: emailAddress("The manufacturer's email"),
      responsibleName: singleLineText({
        label: "The EU responsible person",
        max: 120,
      }).optional(),
      responsibleAddress: multiLineText({
        label: "The EU responsible person's address",
        max: 300,
      }).optional(),
      responsibleEmail: emailAddress("The EU responsible person's email").optional(),
      identifier: singleLineText({ label: "The type, batch or serial", max: 80 }).optional(),
      warnings: multiLineText({ label: "Warnings", max: 2000 }).optional(),
    })
    .optional(),
});
export type ProductDetailsInput = z.infer<typeof productDetailsSchema>;

/**
 * Where the buy button sends a buyer. https only, a real domain (no IPs, no
 * localhost, no bare words), no credentials in the URL, capped length. The DB
 * CHECK repeats the scheme and length rules. Rendered only as an anchor href
 * with rel="noopener noreferrer nofollow", and the host is printed beside the
 * button so the destination is never a surprise.
 */
export const PURCHASE_URL_MAX = 2048;
export const purchaseUrlSchema = z
  .url({
    protocol: /^https$/,
    hostname: z.regexes.domain,
    error: "The purchase link must be a full https:// address.",
  })
  .max(PURCHASE_URL_MAX, `The purchase link must be ${PURCHASE_URL_MAX} characters or fewer.`)
  .refine(
    (value) => {
      // Refinements still run after a failed format check, so a string that
      // is not a URL at all must fail here too rather than throw.
      try {
        const parsed = new URL(value);
        return parsed.username === "" && parsed.password === "";
      } catch {
        return false;
      }
    },
    { error: "The purchase link cannot contain a username or password." },
  );

/**
 * A full product write. For updates, `imageKey`/`digitalFileKey` are
 * three-state: `undefined` = keep the stored key, `null` = clear it,
 * `string` = replace it (must be a key the caller owns — see
 * {@link isOwnedObjectKey}, checked in the server action). The page-detail
 * members follow the same rule: absent = keep what is stored.
 */
export const productWriteSchema = z
  .object({
    title: singleLineText({ label: "A product title", max: 200 }),
    description: multiLineText({ label: "A product description", max: 5000 }),
    priceCents: boundedInt({ label: "Price", min: 1, max: PRICE_CENTS_MAX }),
    currency: z.enum(CURRENCIES),
    status: z.enum(PRODUCT_STATUSES),
    imageKey: z.string().max(600).nullish(),
    digitalFileKey: z.string().max(600).nullish(),
    // Stock tracking (all optional so pre-stock callers/payloads still parse;
    // server actions leave stored values untouched when a field is absent).
    // Quantities are non-negative INTEGERS — the DB checks mirror this.
    trackStock: z.boolean().optional(),
    stockQuantity: z.number().int().min(0).max(STOCK_QUANTITY_MAX).nullish(),
    lowStockThreshold: z.number().int().min(0).max(STOCK_QUANTITY_MAX).optional(),
    // Product page detail. Lists are replaced whole (there is no per-item
    // patch), so an empty array clears; absent leaves the stored value alone.
    gallery: z
      .array(galleryImageSchema)
      .max(GALLERY_MAX, `A product can have up to ${GALLERY_MAX} extra photos.`)
      .optional(),
    optionGroups: z
      .array(optionGroupSchema)
      .max(OPTION_GROUPS_MAX, `A product can have up to ${OPTION_GROUPS_MAX} option groups.`)
      .optional(),
    details: productDetailsSchema.optional(),
    documents: z
      .array(documentSchema)
      .max(DOCUMENTS_MAX, `A product can have up to ${DOCUMENTS_MAX} documents.`)
      .optional(),
    purchaseUrl: purchaseUrlSchema.nullish(),
    // Which of the storefront's shipping profiles this product ships under.
    // `null` = the store's default terms, which is what nearly every product
    // wants; absent = leave the stored choice alone. NOT checked against the
    // storefront's profile list here: a product can sit on more than one
    // storefront, so there is no single list to check against, and an id that
    // resolves nowhere falls back to the store default by design (see
    // lib/storefront/shipping.ts).
    shippingProfileId: uuidField("That shipping profile").nullish(),
  })
  // Mirrors the DB constraint: tracking without a concrete quantity is invalid.
  .refine(
    (data) => data.trackStock !== true || typeof data.stockQuantity === "number",
    { error: "Set how many are in stock.", path: ["stockQuantity"] },
  )
  // EVERY id in the option tree is unique, group ids and option ids alike and
  // across groups, not merely within one. A photo tie and the page's `?o=`
  // parameter name an option id on its own with no group beside it, so a
  // repeated id would make "which option is this" unanswerable.
  .refine((data) => !data.optionGroups || uniqueOptionTreeIds(data.optionGroups), {
    error: "Each option can only be listed once.",
    path: ["optionGroups"],
  })
  .refine(
    (data) =>
      !data.optionGroups ||
      data.optionGroups.reduce((total, group) => total + group.options.length, 0) <=
        OPTIONS_TOTAL_MAX,
    {
      error: `A product can have up to ${OPTIONS_TOTAL_MAX} options in total.`,
      path: ["optionGroups"],
    },
  )
  // A photo tied to an option must name one that exists in the same payload
  // (or, when the payload keeps the stored groups, this check is the action's
  // job against the stored list; see parseWrite).
  .refine(
    (data) => {
      if (!data.gallery || !data.optionGroups) return true;
      const ids = collectOptionIds(data.optionGroups);
      return data.gallery.every((image) => !image.optionId || ids.has(image.optionId));
    },
    { error: "A photo points at an option that no longer exists.", path: ["gallery"] },
  );
export type ProductWriteInput = z.infer<typeof productWriteSchema>;

export const productIdSchema = z.uuid();

// Keys are minted server-side as {prefix}/{ownerId}/{uuid}-{sanitizedName}
// (see lib/r2.ts), so a stored key must match that shape exactly. Exported for
// other schemas that store object keys (e.g. storefront background images).
export const OBJECT_KEY_PATTERN =
  /^(images|files|fonts|elements|documents)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,200}$/;

/** The bucket prefix a kind's objects live under. One place, because the key
 *  pattern, the key builder and the ownership check must agree exactly. */
export function objectKeyPrefix(kind: UploadKind): string {
  switch (kind) {
    case "image":
      return "images";
    case "font":
      return "fonts";
    case "file":
      return "files";
    case "element":
      return "elements";
    // A prefix of its own, not `files/`: a public manual and a paywalled
    // download must not be indistinguishable by key. It is what lets the
    // save-time verification apply the document caps (20 MB, PDF only) to a
    // document without weakening what it enforces on a digital file.
    case "document":
      return "documents";
  }
}

/**
 * True if `key` is well-formed AND lives under the caller's own prefix for the
 * given kind. Prevents a client from linking someone else's object (or an
 * arbitrary path) to their product row.
 */
export function isOwnedObjectKey(
  key: string,
  kind: UploadKind,
  ownerId: string,
): boolean {
  return (
    OBJECT_KEY_PATTERN.test(key) &&
    key.startsWith(`${objectKeyPrefix(kind)}/${ownerId}/`)
  );
}
