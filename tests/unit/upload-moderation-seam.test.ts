// @vitest-environment node
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { moderateUpload, QUARANTINE_PREFIX } from "@/lib/moderation";
import { isOwnedObjectKey } from "@/lib/validation/product";

/**
 * The moderation SEAM. There is no moderation provider yet; what these pin is
 * that one can be attached later without hunting for call sites — and that the
 * guarantees the seam depends on are still standing.
 *
 * The load-bearing one is that images cannot reach a product except through
 * the route that moderates them. If the presign endpoint ever starts handing
 * out image URLs again, moderation becomes bypassable by any client that calls
 * it directly, and no amount of care inside the provider would help.
 */

const repoFile = (...parts: string[]) =>
  readFileSync(join(process.cwd(), ...parts), "utf8");

describe("moderateUpload - the default no-op", () => {
  it("allows content, because there is no provider to consult yet", async () => {
    const verdict = await moderateUpload({
      kind: "product-image",
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      contentType: "image/jpeg",
      uploaderId: "00000000-0000-4000-8000-000000000001",
      accountId: "00000000-0000-4000-8000-000000000002",
    });
    expect(verdict).toEqual({ decision: "allow" });
  });

  it("receives the real bytes, so a classifier can be dropped in as-is", async () => {
    // If this ever stops taking bytes, a provider cannot be attached without
    // changing every call site — which is the thing the seam exists to avoid.
    await expect(
      moderateUpload({
        kind: "product-image",
        bytes: new Uint8Array(16),
        contentType: "image/png",
        uploaderId: "u",
        accountId: "a",
      }),
    ).resolves.toBeDefined();
  });
});

describe("quarantine keys can never be attached to a product", () => {
  const owner = "11111111-1111-4111-8111-111111111111";
  const live = `images/${owner}/22222222-2222-4222-8222-222222222222-photo.png`;

  it("accepts a normal image key", () => {
    expect(isOwnedObjectKey(live, "image", owner)).toBe(true);
  });

  it("rejects the same key under the quarantine prefix", () => {
    // Held content is stored, but stored somewhere the product write path
    // structurally cannot reference — belt as well as braces.
    expect(isOwnedObjectKey(`${QUARANTINE_PREFIX}/${live}`, "image", owner)).toBe(false);
  });
});

describe("images have exactly one route into storage", () => {
  it("there is no presigned-upload endpoint left to bypass it", () => {
    // A presigned PUT hands the client a URL that writes straight into the
    // bucket, so anything minted that way reaches storage without the server
    // ever seeing its bytes — moderation could simply be skipped by calling
    // that endpoint directly. It is gone; if one ever comes back, this has to
    // be reconsidered at the same time.
    expect(
      existsSync(join(process.cwd(), "src", "app", "api", "uploads", "presign")),
    ).toBe(false);
  });

  it("the client sends EVERY kind to our own server, never to R2", () => {
    const client = repoFile("src", "lib", "products", "upload.ts");
    // Each kind's destination is a path on this origin, not a bucket URL.
    expect(client).toMatch(/"\/api\/uploads\/image"/);
    expect(client).toMatch(/"\/api\/uploads\/font"/);
    expect(client).toMatch(/uploadFileViaServer\(file, onProgress\)/);
    // No bucket host anywhere in the client: a cross-origin PUT is what made
    // uploads depend on the bucket's CORS allowlist naming every origin.
    expect(client).not.toMatch(/r2\.cloudflarestorage\.com/);
  });

  it("the image route moderates BEFORE it stores", () => {
    const route = repoFile("src", "app", "api", "uploads", "image", "route.ts");
    const moderatedAt = route.indexOf("moderateUpload(");
    const storedAt = route.indexOf("await putObject(");
    expect(moderatedAt).toBeGreaterThan(-1);
    expect(storedAt).toBeGreaterThan(-1);
    expect(moderatedAt).toBeLessThan(storedAt);
  });

  it("the image route sniffs magic bytes rather than trusting the claim", () => {
    const route = repoFile("src", "app", "api", "uploads", "image", "route.ts");
    expect(route).toMatch(/sniffImage\(bytes\)/);
    // The sniffed type is what gets stored, so R2 serves what it really is.
    // `[^)]*` already crosses newlines, so no dotAll flag is needed (and the
    // repo's TS target predates it).
    expect(route).toMatch(/putObject\([^)]*sniffed\.mime/);
  });
});
