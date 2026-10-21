import { describe, expect, it } from "vitest";
import { UPLOAD_KINDS, objectKeyPrefix } from "@/lib/validation/product";
import { isObjectKey } from "@/lib/account-deletion/object-keys";
import {
  UPLOAD_PREFIXES,
  isUploadKey,
  parseListPage,
  planSweep,
  type StoredObject,
} from "../../scripts/lib/unused-uploads";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const key = (prefix: string, name = "photo.webp") => `${prefix}/${U1}/${U2}-${name}`;
const NOW = new Date("2026-10-21T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 864e5).toISOString();
const obj = (k: string, age: number, size = 100): StoredObject => ({ key: k, size, lastModified: daysAgo(age) });

describe("unused upload sweep", () => {
  it("knows exactly the app's upload prefixes and key shape", () => {
    expect([...UPLOAD_PREFIXES]).toEqual(UPLOAD_KINDS.map(objectKeyPrefix));
    for (const prefix of UPLOAD_PREFIXES) {
      expect(isUploadKey(key(prefix))).toBe(true);
      expect(isObjectKey(key(prefix))).toBe(true);
    }
    expect(isUploadKey("avatars/abc.webp")).toBe(false);
    expect(isUploadKey(`images/${U1}/${U2}`)).toBe(false);
  });

  it("only ever proposes old, upload-shaped files that nothing references", () => {
    const used = obj(key("images", "used.webp"), 30);
    const orphan = obj(key("documents", "manual.pdf"), 30, 2048);
    const fresh = obj(key("images", "fresh.webp"), 1);
    const foreign = obj("avatars/someone.webp", 400);
    const plan = planSweep([used, orphan, fresh, foreign], new Set([used.key]), NOW);
    expect(plan.unused).toEqual([orphan]);
    expect(plan.tooNew).toEqual([fresh]);
    expect(plan.other).toEqual([foreign]);
    expect(plan.usedCount).toBe(1);
  });

  it("reads an S3 list page and its continuation token", () => {
    const xml = `<ListBucketResult><IsTruncated>true</IsTruncated>
      <Contents><Key>${key("images")}</Key><LastModified>2026-10-01T00:00:00.000Z</LastModified><Size>1234</Size></Contents>
      <Contents><Key>a&amp;b.txt</Key><LastModified>2026-10-02T00:00:00.000Z</LastModified><Size>5</Size></Contents>
      <NextContinuationToken>tok/123</NextContinuationToken></ListBucketResult>`;
    const page = parseListPage(xml);
    expect(page.objects).toEqual([
      { key: key("images"), size: 1234, lastModified: "2026-10-01T00:00:00.000Z" },
      { key: "a&b.txt", size: 5, lastModified: "2026-10-02T00:00:00.000Z" },
    ]);
    expect(page.next).toBe("tok/123");
    expect(parseListPage("<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>").next).toBeNull();
  });
});
