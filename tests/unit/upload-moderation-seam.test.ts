// @vitest-environment node
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * WHERE UPLOADS MEET MODERATION. Content is judged when the row that uses a
 * file is saved (the moderation wall, tests/integration/37-auto-moderation),
 * not here. What these pin is the part of the guarantee that only the upload
 * path can hold up:
 *
 *   - every image reaches storage through a route of ours that holds its
 *     bytes, so its real type is a fact and nothing can be swapped in behind a
 *     key after the fact (a presigned PUT would allow exactly that);
 *   - a file the classifier cannot fully see (an animation, an AVIF, an SVG)
 *     is flagged for a person before its key is handed back.
 */

const repoFile = (...parts: string[]) =>
  readFileSync(join(process.cwd(), ...parts), "utf8");

describe("images have exactly one route into storage", () => {
  it("there is no presigned-upload endpoint left to bypass it", () => {
    // A presigned PUT hands the client a URL that writes straight into the
    // bucket: the server never sees the bytes, so it cannot tell an animation
    // from a still, and the client can overwrite the object after it has been
    // approved. It is gone; if one ever comes back, the moderation wall's
    // guarantee has to be reconsidered at the same time.
    expect(
      existsSync(join(process.cwd(), "src", "app", "api", "uploads", "presign")),
    ).toBe(false);
  });

  it("the client sends EVERY kind to our own server, never to R2", () => {
    const client = repoFile("src", "lib", "products", "upload.ts");
    // Each kind's destination is a path on this origin, not a bucket URL.
    expect(client).toMatch(/"\/api\/uploads\/image"/);
    expect(client).toMatch(/"\/api\/uploads\/font"/);
    expect(client).toMatch(/"\/api\/uploads\/element"/);
    expect(client).toMatch(/"\/api\/uploads\/file"/);
    // Documents post to their own route, not the digital file's: it is the
    // one that enforces PDF-only, 20 MB and the document rate-limit budget.
    expect(client).toMatch(/"\/api\/uploads\/document"/);
    // No bucket host anywhere in the client: a cross-origin PUT is what made
    // uploads depend on the bucket's CORS allowlist naming every origin.
    expect(client).not.toMatch(/r2\.cloudflarestorage\.com/);
  });

  it.each(["image", "element"])(
    "the %s route flags what the classifier cannot see, or refuses the upload",
    (name) => {
      // The image route's bytes go through the function it shares with upload_image.
      const route =
        name === "image"
          ? repoFile("src", "lib", "uploads", "store-image.ts")
          : repoFile("src", "app", "api", "uploads", name, "route.ts");
      // Asked of the real bytes, and a hold that cannot be recorded is not
      // waved through: the object is deleted and no key is returned.
      expect(route).toMatch(/classifierCanSee\(bytes, sniffed\.mime\)/);
      expect(route).toMatch(/!\(await holdForPerson\(key\)\)/);
      const heldAt = route.indexOf("holdForPerson(key)");
      const refusedAt = route.indexOf("deleteObject(key)", heldAt);
      const returnedAt = route.lastIndexOf(name === "image" ? "return { ok: true, key }" : "Response.json({ key })");
      expect(heldAt).toBeGreaterThan(-1);
      expect(refusedAt).toBeGreaterThan(heldAt);
      expect(returnedAt).toBeGreaterThan(refusedAt);
    },
  );

  it("the element route holds every SVG for a person", () => {
    const route = repoFile("src", "app", "api", "uploads", "element", "route.ts");
    expect(route).toMatch(/\(svg \|\| !classifierCanSee\(bytes, sniffed\.mime\)\)/);
  });

  it("no upload route classifies content itself any more", () => {
    // One checker (lib/moderation/auto), reached through the wall. A second
    // classifier here is a second policy.
    expect(existsSync(join(process.cwd(), "src", "lib", "moderation", "index.ts"))).toBe(false);
    for (const name of ["image", "element", "font", "file", "document"]) {
      expect(repoFile("src", "app", "api", "uploads", name, "route.ts")).not.toMatch(
        /moderateUpload|classifyMedia|classifyText/,
      );
    }
  });

  it("the image route sniffs magic bytes rather than trusting the claim", () => {
    // One function, shared with an assistant's upload_image, so neither door
    // is a way around it.
    const route = repoFile("src", "app", "api", "uploads", "image", "route.ts");
    expect(route).toMatch(/storeImage\(bytes,/);
    expect(route).not.toMatch(/putObject/);
    const store = repoFile("src", "lib", "uploads", "store-image.ts");
    expect(store).toMatch(/sniffImage\(bytes\)/);
    // The sniffed type is what gets stored, so R2 serves what it really is.
    // `[^)]*` already crosses newlines, so no dotAll flag is needed (and the
    // repo's TS target predates it).
    expect(store).toMatch(/putObject\([^)]*sniffed\.mime/);
  });

  it("the document route gates a PUBLIC download harder than the paid one", () => {
    const route = repoFile("src", "app", "api", "uploads", "document", "route.ts");
    // Signed in, permitted to write products, and inside its OWN budget: a
    // document may not spend the digital-file allowance, and vice versa.
    expect(route).toMatch(/getActiveAccount\(\)/);
    expect(route).toMatch(/can\(account\.role, "products\.write"\)/);
    expect(route).toMatch(/RATE_LIMITS\.documentUpload/);
    expect(route).not.toMatch(/RATE_LIMITS\.fileUpload/);
    // Bounded before a byte is streamed, and against the document cap.
    expect(route).toMatch(/DOCUMENT_MAX_BYTES/);
    expect(route).not.toMatch(/DIGITAL_FILE_MAX_BYTES/);
    // POSITIVE identification: the bytes must BE a PDF. The file route can
    // only ask whether the claim is a provable lie (text has no signature);
    // here the single accepted type has a magic number, so anything else is
    // refused rather than stored under a type nothing will scrutinise.
    expect(route).toMatch(/sniffFile\(head\) !== "pdf"/);
    // Its own prefix, so a public manual and a paywalled download can never
    // be the same key, which is what lets the save-time HEAD apply the
    // document caps to one and the file caps to the other.
    expect(route).toMatch(/buildObjectKey\("document"/);
  });
});
