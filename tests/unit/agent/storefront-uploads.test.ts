// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyDesignOps, DesignOpRefused } from "@/lib/storefront/design-ops";
import { isOwnedObjectKey } from "@/lib/validation/product";
import { storefrontConfigSchema } from "@/lib/validation/storefront";
import { DEFAULT_STOREFRONT_CONFIG } from "@/types/storefront";

/**
 * The storefront's files as an assistant brings them: its own typeface
 * (upload_font) and the store's own product photos (copy_product_photo).
 *
 * Storage, the upload ledger and the product read are stood in for. What is
 * pinned is what decides whether bytes are stored and under which key: the key
 * is the one saveStorefront's verifyUpload accepts (the uploader's own, under
 * the prefix its place demands), the bytes are judged by what they are, a
 * photo comes only from this store's own product, and a refusal says what to
 * do instead.
 */

const UPLOADER = "33333333-3333-4333-8333-333333333333";
const ACCOUNT = "44444444-4444-4444-8444-444444444444";
const PRODUCT = "55555555-5555-4555-8555-555555555555";
const TAKEN_DOWN = "66666666-6666-4666-8666-666666666666";
const MAIN = `images/${UPLOADER}/77777777-7777-4777-8777-777777777777-lamp.png`;
const SECOND = `images/${UPLOADER}/88888888-8888-4888-8888-888888888888-lamp-side.png`;

vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const storage = vi.hoisted(() => ({
  puts: [] as { key: string; contentType: string; size: number }[],
  objects: new Map<string, Uint8Array>(),
}));
vi.mock("@/lib/r2", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/r2")>();
  return {
    ...real,
    putObject: vi.fn(async (key: string, bytes: Uint8Array, contentType: string) => {
      storage.puts.push({ key, contentType, size: bytes.byteLength });
    }),
    getObject: vi.fn(async (key: string, maxBytes: number) => {
      const bytes = storage.objects.get(key);
      if (!bytes) return { ok: false, reason: "missing" };
      if (bytes.byteLength > maxBytes) return { ok: false, reason: "too_large" };
      return { ok: true, bytes };
    }),
  };
});
vi.mock("@/lib/moderation/auto/check", () => ({ holdForPerson: vi.fn(async () => true) }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  rateLimit: vi.fn(async () => true),
}));
const ledger = vi.hoisted(() => ({ uploads: [] as { kind: string; objectKey: string }[] }));
vi.mock("@/lib/agent/object-refs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent/object-refs")>()),
  rememberUpload: vi.fn(async (input: { kind: string; objectKey: string }) => {
    ledger.uploads.push(input);
    return `upload:99999999-9999-4999-8999-${String(ledger.uploads.length).padStart(12, "0")}`;
  }),
}));
/** The products row level security lets this store read, and nothing else. */
const rows = vi.hoisted(() => new Map<string, Record<string, unknown>>());
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => ({
      select: () => {
        const filters: Record<string, unknown> = {};
        const chain = {
          eq: (column: string, value: unknown) => {
            filters[column] = value;
            return chain;
          },
          maybeSingle: async () => {
            const row = rows.get(String(filters.id));
            return { data: row && filters.owner_id === row.owner_id ? row : null, error: null };
          },
        };
        return chain;
      },
    }),
  })),
}));

const { findTool } = await import("@/lib/agent/tools");
const { ToolFailure } = await import("@/lib/agent/tool");
const call = { account: { accountId: ACCOUNT, userId: UPLOADER, role: "owner", isOwner: true }, grantId: ACCOUNT } as never;

/** Bytes that ARE what `head` says, padded to `size`. */
function file(head: number[] | string, size = 64): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(typeof head === "string" ? [...head].map((char) => char.charCodeAt(0)) : head, 0);
  return bytes;
}
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/** What a refusal says, message and fix together. */
async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ToolFailure);
    const failure = (error as InstanceType<typeof ToolFailure>).error as unknown as { code: string; message: unknown; fix?: unknown };
    return JSON.stringify([failure.code, failure.message, failure.fix]);
  }
  throw new Error("expected a refusal");
}

beforeEach(() => {
  storage.puts.length = 0;
  storage.objects.clear();
  ledger.uploads.length = 0;
  rows.clear();
  rows.set(PRODUCT, { id: PRODUCT, owner_id: ACCOUNT, image_key: MAIN, gallery: [{ key: SECOND, alt: "" }], moderation_status: "ok" });
  rows.set(TAKEN_DOWN, { id: TAKEN_DOWN, owner_id: ACCOUNT, image_key: MAIN, gallery: [], moderation_status: "removed" });
  storage.objects.set(MAIN, file(PNG, 1024));
  storage.objects.set(SECOND, file(PNG, 3 * 1024 * 1024));
});

describe("upload_font", () => {
  const upload = (input: Record<string, unknown>) => findTool("upload_font")!.handler(input as never, call);

  it("stores a real font under the caller's own fonts/ key, the one a storefront save accepts", async () => {
    const result = (await upload({ base64: base64(file("wOF2")), filename: "Fraunces.woff2" })) as { uploadId: string };
    expect(result.uploadId).toMatch(/^upload:/);
    expect(storage.puts).toHaveLength(1);
    expect(storage.puts[0].contentType).toBe("font/woff2");
    expect(isOwnedObjectKey(storage.puts[0].key, "font", UPLOADER)).toBe(true);
    expect(ledger.uploads).toEqual([{ grantId: ACCOUNT, kind: "font", objectKey: storage.puts[0].key }]);
  });

  it("refuses a file that is not a font, however it is named, and one past the cap", async () => {
    expect(await refusal(upload({ base64: base64(file(PNG)), filename: "Face.woff2" }))).toContain("WOFF2, WOFF, TTF or OTF");
    expect(await refusal(upload({ base64: base64(file("wOF2", 2 * 1024 * 1024 + 1)) }))).toContain("could not be read");
    expect(await refusal(upload({}))).toContain("could not be read");
    expect(storage.puts).toHaveLength(0);
  });

  it("is named in a theme change by its file, and only a font upload is taken", () => {
    const font = `fonts/${UPLOADER}/77777777-7777-4777-8777-777777777777-Fraunces.woff2`;
    const { config } = applyDesignOps(DEFAULT_STOREFRONT_CONFIG, [
      { op: "theme", changes: { customFont: { file: font, name: "Fraunces" }, font: "custom", fontPairing: null } },
    ]);
    expect(config.theme).toMatchObject({ customFont: { key: font, name: "Fraunces" }, font: "custom" });
    expect(storefrontConfigSchema.safeParse(config).success).toBe(true);
    expect(() =>
      applyDesignOps(DEFAULT_STOREFRONT_CONFIG, [{ op: "theme", changes: { customFont: { file: MAIN, name: "Lamp" } } }]),
    ).toThrow(DesignOpRefused);
  });
});

describe("copy_product_photo", () => {
  const copy = (input: Record<string, unknown>) => findTool("copy_product_photo")!.handler(input as never, call);

  it("copies the main photo as artwork, under the caller's own elements/ key", async () => {
    await copy({ productId: PRODUCT, as: "artwork" });
    expect(storage.puts).toHaveLength(1);
    expect(storage.puts[0]).toMatchObject({ contentType: "image/png", size: 1024 });
    expect(isOwnedObjectKey(storage.puts[0].key, "element", UPLOADER)).toBe(true);
    expect(storage.puts[0].key).toMatch(/-lamp\.png$/);
    expect(ledger.uploads[0]).toMatchObject({ kind: "element" });
  });

  it("copies a gallery photo as a photo, under images/, for a band or the board", async () => {
    await copy({ productId: PRODUCT, index: 1, as: "photo" });
    expect(isOwnedObjectKey(storage.puts[0].key, "image", UPLOADER)).toBe(true);
    expect(storage.puts[0].key).not.toBe(SECOND);
    expect(ledger.uploads[0]).toMatchObject({ kind: "image" });
  });

  it("refuses a photo past what artwork may be, and says to use it as a photo", async () => {
    const words = await refusal(copy({ productId: PRODUCT, index: 1, as: "artwork" }));
    expect(words).toContain("2 MB");
    expect(words).toContain("as a photo");
    expect(storage.puts).toHaveLength(0);
  });

  it("finds only this store's products, refuses a taken-down one, and counts the photos", async () => {
    rows.set(PRODUCT, { ...rows.get(PRODUCT)!, owner_id: UPLOADER });
    expect(await refusal(copy({ productId: PRODUCT, as: "artwork" }))).toContain("not_found");
    expect(await refusal(copy({ productId: TAKEN_DOWN, as: "artwork" }))).toContain("taken down");
    rows.set(PRODUCT, { ...rows.get(PRODUCT)!, owner_id: ACCOUNT });
    expect(await refusal(copy({ productId: PRODUCT, index: 2, as: "photo" }))).toContain("has 2 photos");
    expect(storage.puts).toHaveLength(0);
  });

  it("copies a photo still waiting on its check: the storefront's save judges the copy", async () => {
    rows.set(PRODUCT, { ...rows.get(PRODUCT)!, moderation_status: "pending" });
    await copy({ productId: PRODUCT, as: "artwork" });
    expect(storage.puts).toHaveLength(1);
  });

  it("copies nothing that is not a stored file of ours", async () => {
    rows.set(PRODUCT, { ...rows.get(PRODUCT)!, image_key: "https://images.example.com/lamp.png" });
    expect(await refusal(copy({ productId: PRODUCT, as: "photo" }))).toContain("cannot be copied");
    expect(storage.puts).toHaveLength(0);
  });

  it("takes a product id and which photo, never a key or a URL", () => {
    const input = findTool("copy_product_photo")!.input;
    expect(input.safeParse({ productId: PRODUCT, as: "photo", key: MAIN }).success).toBe(false);
    expect(input.safeParse({ productId: PRODUCT, as: "photo", url: "https://example.com/a.png" }).success).toBe(false);
    expect(input.safeParse({ productId: PRODUCT, as: "background" }).success).toBe(false);
  });
});
