// @vitest-environment node
import { describe, expect, it, vi, beforeAll } from "vitest";

/**
 * The image upload route, exercised end to end against REAL object storage.
 *
 * This is the path that was broken: product images had never once reached the
 * database. A test that mocks storage would have stayed green throughout, so
 * this one does the actual PUT and then reads the object back.
 *
 * Skipped unless R2 credentials are present, so a checkout without them still
 * runs a clean suite:  node --env-file=.env.local ... vitest run
 */

/**
 * Requires an EXPLICIT opt-in, not merely the presence of credentials. This
 * file makes real network calls, and letting it join the default parallel run
 * stretched the suite past ten minutes and flaked unrelated timing-sensitive
 * component tests. Run it deliberately:
 *
 *   R2_LIVE_TEST=1 node --env-file=.env.local node_modules/vitest/vitest.mjs \
 *     run --project unit tests/unit/upload-image-route.test.ts
 */
const HAS_R2 = Boolean(
  process.env.R2_LIVE_TEST === "1" &&
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_BUCKET_NAME &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY,
);

const UPLOADER = "33333333-3333-4333-8333-333333333333";

// Auth and the rate limiter are not what this test is about; both have their
// own coverage. Everything below them is real.
vi.mock("@/lib/team/account-context", () => ({
  getActiveAccount: vi.fn(async () => ({
    accountId: UPLOADER,
    userId: UPLOADER,
    role: "owner" as const,
    isOwner: true,
  })),
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  rateLimit: vi.fn(async () => true),
}));

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function request(file: File): Request {
  const body = new FormData();
  body.append("image", file);
  return new Request("http://localhost/api/uploads/image", { method: "POST", body });
}

const png = () =>
  new File([Buffer.from(PNG_BASE64, "base64")], "probe.png", { type: "image/png" });

describe.skipIf(!HAS_R2)("POST /api/uploads/image - against real R2", () => {
  let POST: (r: Request) => Promise<Response>;
  let headObject: (key: string) => Promise<{ size: number; contentType: string | null } | null>;
  let deleteObject: (key: string) => Promise<void>;

  beforeAll(async () => {
    ({ POST } = await import("@/app/api/uploads/image/route"));
    ({ headObject, deleteObject } = await import("@/lib/r2"));
  });

  it("stores a REALISTIC-SIZED image, not just a token fixture", async () => {
    // The original version of this test used a 70-byte PNG and passed while
    // every real photo failed: R2 answers a chunked PUT with 411, and small
    // bodies are the only ones that go out with a Content-Length by default.
    // 512 KB is past that threshold.
    const big = new Uint8Array(512 * 1024);
    big.set(Buffer.from(PNG_BASE64, "base64"), 0);
    const res = await POST(
      request(new File([big], "large.png", { type: "image/png" })),
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const { key } = (await res.json()) as { key: string };
    const meta = await headObject(key);
    expect(meta?.size).toBe(512 * 1024);
    await deleteObject(key);
  });

  it("stores the image and returns a key the product write path accepts", async () => {
    const res = await POST(request(png()));
    expect(res.status, await res.clone().text()).toBe(200);
    const { key } = (await res.json()) as { key: string };

    // The key must satisfy the same gate createProduct/updateProduct apply,
    // or the upload succeeds and the save then rejects it — which is exactly
    // the class of failure that left every product on a seeded stock photo.
    const { isOwnedObjectKey } = await import("@/lib/validation/product");
    expect(isOwnedObjectKey(key, "image", UPLOADER)).toBe(true);

    // And the bytes really are in the bucket, served as a PNG.
    const meta = await headObject(key);
    expect(meta).not.toBeNull();
    expect(meta!.size).toBeGreaterThan(0);
    expect(meta!.contentType).toBe("image/png");

    await deleteObject(key);
  });

  it("refuses a file that only claims to be an image", async () => {
    // Declared image/png, actually a script. The old presigned PUT would have
    // stored this verbatim: nothing server-side ever saw the bytes.
    const liar = new File([Buffer.from("<script>alert(1)</script>      ")], "x.png", {
      type: "image/png",
    });
    const res = await POST(request(liar));
    expect(res.status).toBe(415);
  });

  it("refuses an empty file", async () => {
    const res = await POST(request(new File([], "empty.png", { type: "image/png" })));
    expect(res.status).toBe(400);
  });

  it("refuses unexpected multipart fields", async () => {
    const body = new FormData();
    body.append("image", png());
    body.append("surprise", "value");
    const res = await POST(
      new Request("http://localhost/api/uploads/image", { method: "POST", body }),
    );
    expect(res.status).toBe(400);
  });
});

describe.skipIf(!HAS_R2)("moderation verdicts are honoured", () => {
  it("a reject verdict stores nothing and tells the uploader why", async () => {
    vi.resetModules();
    vi.doMock("@/lib/moderation", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/moderation")>()),
      moderateUpload: vi.fn(async () => ({
        decision: "reject" as const,
        reason: "That image breaks the content rules.",
      })),
    }));
    const { POST } = await import("@/app/api/uploads/image/route");

    const res = await POST(request(png()));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("That image breaks the content rules.");
    vi.doUnmock("@/lib/moderation");
    vi.resetModules();
  });

  it("a review verdict yields NO key, so nothing can be published", async () => {
    vi.resetModules();
    vi.doMock("@/lib/moderation", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/moderation")>()),
      moderateUpload: vi.fn(async () => ({
        decision: "review" as const,
        reason: "borderline",
      })),
    }));
    const { POST } = await import("@/app/api/uploads/image/route");

    const res = await POST(request(png()));
    const body = (await res.json()) as { key?: string };
    // The contract the client relies on: 2xx without a key is not success.
    expect(body.key).toBeUndefined();
    vi.doUnmock("@/lib/moderation");
    vi.resetModules();
  });
});
