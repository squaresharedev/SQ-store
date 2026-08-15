import { describe, expect, it } from "vitest";
import { buildObjectKey, sanitizeFilename } from "@/lib/r2";
import { isOwnedObjectKey } from "@/lib/validation/product";

const OWNER = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-8888-7777-6666-555555555555";

describe("sanitizeFilename", () => {
  it("keeps simple names", () => {
    expect(sanitizeFilename("photo.png")).toBe("photo.png");
  });

  it("strips path traversal on both separators", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("..\\..\\windows\\system32\\cmd.exe")).toBe("cmd.exe");
    expect(sanitizeFilename("/absolute/path/file.zip")).toBe("file.zip");
  });

  it("never emits a leading dot (no hidden/relative segments)", () => {
    expect(sanitizeFilename(".htaccess")).toBe("htaccess");
    expect(sanitizeFilename("..")).toBe("file");
    expect(sanitizeFilename("...tricky")).toBe("tricky");
  });

  it("replaces unsafe characters", () => {
    expect(sanitizeFilename("my photo (1).png")).toBe("my-photo-1-.png");
    expect(sanitizeFilename("naïve café.jpg")).toBe("na-ve-caf-.jpg");
    expect(sanitizeFilename("<script>.js")).toBe("script-.js");
  });

  it("caps length at 120", () => {
    expect(sanitizeFilename("a".repeat(500)).length).toBeLessThanOrEqual(120);
  });

  it("empty/garbage input degrades to 'file'", () => {
    expect(sanitizeFilename("")).toBe("file");
    expect(sanitizeFilename("///")).toBe("file");
    expect(sanitizeFilename("日本語")).toBe("file"); // fully non-ASCII collapses...
  });
});

describe("buildObjectKey", () => {
  it("mints an owned, well-formed image key", () => {
    const key = buildObjectKey("image", OWNER, "photo.png");
    expect(key.startsWith(`images/${OWNER}/`)).toBe(true);
    expect(isOwnedObjectKey(key, "image", OWNER)).toBe(true);
  });

  it("mints an owned, well-formed file key", () => {
    const key = buildObjectKey("file", OWNER, "album.zip");
    expect(key.startsWith(`files/${OWNER}/`)).toBe(true);
    expect(isOwnedObjectKey(key, "file", OWNER)).toBe(true);
  });

  it("mints an owned, well-formed element key", () => {
    const key = buildObjectKey("element", OWNER, "logo.svg");
    expect(key.startsWith(`elements/${OWNER}/`)).toBe(true);
    expect(isOwnedObjectKey(key, "element", OWNER)).toBe(true);
  });

  it("even a hostile filename produces a key owned by the caller", () => {
    const key = buildObjectKey("image", OWNER, `../../${OTHER}/steal.png`);
    expect(key.startsWith(`images/${OWNER}/`)).toBe(true);
    expect(key).not.toContain("..");
    expect(isOwnedObjectKey(key, "image", OWNER)).toBe(true);
    expect(isOwnedObjectKey(key, "image", OTHER)).toBe(false);
  });
});

describe("isOwnedObjectKey — the product-save security boundary", () => {
  const VALID_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const good = `images/${OWNER}/${VALID_UUID}-photo.png`;

  it("accepts a well-formed own key", () => {
    expect(isOwnedObjectKey(good, "image", OWNER)).toBe(true);
  });

  it("rejects another user's key (cross-tenant link attempt)", () => {
    const theirs = `images/${OTHER}/${VALID_UUID}-photo.png`;
    expect(isOwnedObjectKey(theirs, "image", OWNER)).toBe(false);
  });

  it("rejects kind confusion: files/ key linked as an image and vice versa", () => {
    const fileKey = `files/${OWNER}/${VALID_UUID}-secret.zip`;
    expect(isOwnedObjectKey(fileKey, "image", OWNER)).toBe(false);
    expect(isOwnedObjectKey(good, "file", OWNER)).toBe(false);
  });

  it("rejects kind confusion between elements/ and images/", () => {
    // The one that matters most: `elements/` is the ONLY prefix that may hold
    // an SVG. If an element key could pass as a product image or a background,
    // markup would reach a surface whose allowlist deliberately excludes it.
    const elementKey = `elements/${OWNER}/${VALID_UUID}-logo.svg`;
    expect(isOwnedObjectKey(elementKey, "element", OWNER)).toBe(true);
    expect(isOwnedObjectKey(elementKey, "image", OWNER)).toBe(false);
    expect(isOwnedObjectKey(elementKey, "font", OWNER)).toBe(false);
    expect(isOwnedObjectKey(elementKey, "file", OWNER)).toBe(false);
    // ...and the reverse, so an element block cannot point at a product photo.
    expect(isOwnedObjectKey(good, "element", OWNER)).toBe(false);
  });

  it("rejects another user's element key", () => {
    const theirs = `elements/${OTHER}/${VALID_UUID}-logo.svg`;
    expect(isOwnedObjectKey(theirs, "element", OWNER)).toBe(false);
  });

  it("rejects path traversal and malformed shapes", () => {
    for (const key of [
      `images/${OWNER}/../${OTHER}/${VALID_UUID}-x.png`,
      `images/${OWNER}/${VALID_UUID}-a/b.png`,
      `images/../${OWNER}/${VALID_UUID}-x.png`,
      `images/${OWNER}/not-a-uuid-x.png`,
      `avatars/${OWNER}/${VALID_UUID}-x.png`,
      `images/${OWNER}/`,
      "",
      `images/${OWNER}/${VALID_UUID}-`,
      `IMAGES/${OWNER}/${VALID_UUID}-x.png`,
    ]) {
      expect(isOwnedObjectKey(key, "image", OWNER)).toBe(false);
    }
  });

  it("rejects uppercase-uuid prefixes (keys are minted lowercase)", () => {
    // Use a letter-bearing uuid so uppercasing actually changes it.
    const upper = VALID_UUID.toUpperCase();
    const key = `images/${upper}/${VALID_UUID}-x.png`;
    expect(isOwnedObjectKey(key, "image", upper)).toBe(false);
    expect(
      isOwnedObjectKey(`images/${OWNER}/${VALID_UUID.toUpperCase()}-x.png`, "image", OWNER),
    ).toBe(false);
  });

  it("rejects unsafe characters in the filename segment", () => {
    for (const name of ["a b.png", "a/b.png", "a%20b.png", "ünïcode.png", "a?.png"]) {
      expect(isOwnedObjectKey(`images/${OWNER}/${VALID_UUID}-${name}`, "image", OWNER)).toBe(false);
    }
  });
});
