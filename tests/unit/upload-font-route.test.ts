// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";
import { isOwnedObjectKey } from "@/lib/validation/product";
import { customFontFamily } from "@/lib/theme/storefront-fonts";

/**
 * The font upload route's gates.
 *
 * Storage is mocked here on purpose (the image route already covers a real PUT
 * against R2): what this file is about is everything the route decides BEFORE
 * bytes are stored: who may upload, how big a font may be, and whether the
 * file is a font at all rather than merely named like one.
 *
 * A font is fetched by every buyer who loads the storefront and is parsed by
 * the browser's own font engine, so "it had a .woff2 on the end" is not a
 * standard this route is allowed to apply.
 */

const UPLOADER = "33333333-3333-4333-8333-333333333333";

// Hoisted with the mocks that read it, so the module factories below can see
// it: `vi.mock` calls run before ordinary module-scope constants exist.
const account = vi.hoisted(() => ({
  current: {
    accountId: "33333333-3333-4333-8333-333333333333",
    userId: "33333333-3333-4333-8333-333333333333",
    role: "owner",
    isOwner: true,
  } as { accountId: string; userId: string; role: string; isOwner: boolean } | null,
}));
const limiter = vi.hoisted(() => ({ allow: true }));
const storage = vi.hoisted(() => ({
  puts: [] as { key: string; contentType: string; size: number }[],
  configured: true,
}));

vi.mock("@/lib/team/account-context", () => ({
  getActiveAccount: vi.fn(async () => account.current),
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  rateLimit: vi.fn(async () => limiter.allow),
}));
vi.mock("@/lib/r2", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/r2")>();
  return {
    ...real,
    hasR2Credentials: () => storage.configured,
    putObject: vi.fn(async (key: string, bytes: Uint8Array, contentType: string) => {
      storage.puts.push({ key, contentType, size: bytes.byteLength });
    }),
  };
});

const { POST } = await import("@/app/api/uploads/font/route");

/** A file whose BYTES are what `head` says, whatever it is named. */
function fontFile(head: number[] | string, name = "Face.woff2", size = 64): File {
  const bytes = new Uint8Array(size);
  const values =
    typeof head === "string" ? [...head].map((c) => c.charCodeAt(0)) : head;
  // A zero-length file has no room for a signature, which is the point of the
  // case that asks for one.
  if (size >= values.length) bytes.set(values, 0);
  return new File([bytes], name);
}

function post(file: File | null, field = "font"): Promise<Response> {
  const body = new FormData();
  if (file) body.append(field, file);
  return POST(
    new Request("http://localhost/api/uploads/font", { method: "POST", body }),
  );
}

const WOFF2 = "wOF2";

beforeEach(() => {
  account.current = {
    accountId: UPLOADER,
    userId: UPLOADER,
    role: "owner",
    isOwner: true,
  };
  limiter.allow = true;
  storage.configured = true;
  storage.puts.length = 0;
});

describe("POST /api/uploads/font", () => {
  it("stores a real font under the caller's own fonts/ prefix", async () => {
    const res = await post(fontFile(WOFF2));
    expect(res.status).toBe(200);
    const { key } = (await res.json()) as { key: string };

    expect(storage.puts).toHaveLength(1);
    expect(storage.puts[0].key).toBe(key);
    // The SNIFFED type is what R2 will serve the object back as.
    expect(storage.puts[0].contentType).toBe("font/woff2");
    // The key is one the save boundary will accept, and one the renderer can
    // derive a family from, which is the two ends of this feature agreeing.
    expect(isOwnedObjectKey(key, "font", UPLOADER)).toBe(true);
    expect(isOwnedObjectKey(key, "image", UPLOADER)).toBe(false);
    expect(customFontFamily(key)).not.toBeNull();
  });

  it("takes the other three formats by their real signatures", async () => {
    for (const [head, mime] of [
      ["wOFF", "font/woff"],
      ["OTTO", "font/otf"],
    ] as const) {
      storage.puts.length = 0;
      const res = await post(fontFile(head));
      expect(res.status).toBe(200);
      expect(storage.puts[0].contentType).toBe(mime);
    }
    storage.puts.length = 0;
    expect((await post(fontFile([0x00, 0x01, 0x00, 0x00]))).status).toBe(200);
    expect(storage.puts[0].contentType).toBe("font/ttf");
  });

  it("refuses a file that is not a font, however it is named", async () => {
    // A PNG, a zip, and an HTML document, all offered as .woff2.
    const impostors: (number[] | string)[] = [
      [0x89, 0x50, 0x4e, 0x47],
      [0x50, 0x4b, 0x03, 0x04],
      "<htm",
    ];
    for (const head of impostors) {
      const res = await post(fontFile(head));
      expect(res.status).toBe(415);
      expect(storage.puts).toHaveLength(0);
    }
  });

  it("refuses a font past the size cap without storing it", async () => {
    const res = await post(fontFile(WOFF2, "Huge.woff2", 2 * 1024 * 1024 + 1));
    expect(res.status).toBe(413);
    expect(storage.puts).toHaveLength(0);
  });

  it("refuses an empty file", async () => {
    const res = await post(fontFile(WOFF2, "Empty.woff2", 0));
    expect(res.status).toBe(400);
    expect(storage.puts).toHaveLength(0);
  });

  it("needs a session, and the right permission on it", async () => {
    account.current = null;
    expect((await post(fontFile(WOFF2))).status).toBe(401);

    // A viewer may read the store but may not change its storefronts, so it
    // may not put bytes in the bucket on the store's behalf either.
    account.current = {
      accountId: UPLOADER,
      userId: UPLOADER,
      role: "viewer",
      isOwner: false,
    };
    expect((await post(fontFile(WOFF2))).status).toBe(403);
    expect(storage.puts).toHaveLength(0);
  });

  it("spends the upload budget, and refuses when it is gone", async () => {
    limiter.allow = false;
    const res = await post(fontFile(WOFF2));
    expect(res.status).toBe(429);
    expect(storage.puts).toHaveLength(0);
  });

  it("refuses unknown form fields rather than ignoring them", async () => {
    const res = await post(fontFile(WOFF2), "notfont");
    expect(res.status).toBe(400);
    expect(storage.puts).toHaveLength(0);
  });

  it("says so plainly when storage is not configured", async () => {
    storage.configured = false;
    const res = await post(fontFile(WOFF2));
    expect(res.status).toBe(503);
  });
});
