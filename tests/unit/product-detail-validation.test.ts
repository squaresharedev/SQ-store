import { describe, expect, it } from "vitest";
import {
  DOCUMENT_CONTENT_TYPES,
  DOCUMENT_MAX_BYTES,
  documentSchema,
  isAllowedContentType,
  isOwnedObjectKey,
  maxBytesForKind,
  objectKeyPrefix,
  productDetailsSchema,
  productWriteSchema,
  purchaseUrlSchema,
} from "@/lib/validation/product";
import { sniffFile } from "@/lib/uploads/sniff";
import {
  parseDetails,
  parseDocuments,
  parseGallery,
  parseOptionGroups,
  reconcileGalleryOptions,
} from "@/lib/products/detail";
import {
  DOCUMENTS_MAX,
  GALLERY_MAX,
  OPTION_GROUPS_MAX,
  OPTIONS_PER_GROUP_MAX,
  OPTIONS_TOTAL_MAX,
} from "@/types/product";

const OWNER = "11111111-1111-4111-8111-111111111111";
const STRANGER = "99999999-9999-4999-8999-999999999999";
const key = (n: number) => `images/${OWNER}/${OWNER.slice(0, 8)}-1111-4111-8111-${String(n).padStart(12, "0")}-photo.jpg`;
const docKey = (n: number) => `files/${OWNER}/${OWNER.slice(0, 8)}-1111-4111-8111-${String(n).padStart(12, "0")}-cert.pdf`;
const optionId = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`;
const groupId = (n: number) => `33333333-3333-4333-8333-${String(n).padStart(12, "0")}`;

/** A group of `count` options, ids offset so several groups can coexist. */
const group = (n: number, count: number, name = `Axis ${n}`) => ({
  id: groupId(n),
  name,
  display: "chip" as const,
  options: Array.from({ length: count }, (_, i) => ({
    id: optionId(n * 100 + i),
    name: `Option ${i}`,
    available: true,
  })),
});

const baseWrite = {
  title: "Lamp",
  description: "",
  priceCents: 1200,
  currency: "EUR",
  status: "active",
};

describe("purchaseUrlSchema", () => {
  it("accepts a plain https address", () => {
    expect(purchaseUrlSchema.safeParse("https://shop.example.com/p/1?ref=a").success).toBe(true);
  });

  it("refuses http, other schemes, credentials, IPs and oversize", () => {
    for (const bad of [
      "http://shop.example.com/p/1",
      "javascript:alert(1)",
      "https://user:pw@shop.example.com/",
      "https://127.0.0.1/",
      "https://localhost/",
      "shop.example.com/p/1",
      `https://shop.example.com/${"a".repeat(2100)}`,
    ]) {
      expect(purchaseUrlSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("productDetailsSchema", () => {
  it("accepts a full block and refuses unknown keys", () => {
    const details = {
      dimensions: { length: 10, width: 5.5, unit: "cm" },
      weight: { value: 1.2, unit: "kg" },
      materials: "Oak",
      included: ["Lamp", "Cable"],
      specs: [{ label: "Wattage", value: "40 W" }],
      origin: "Portugal",
      safety: {
        manufacturerName: "Lampworks",
        manufacturerAddress: "1 Street\nLisbon",
        manufacturerEmail: "safety@lampworks.example",
        warnings: "Keep away from water.",
      },
    };
    expect(productDetailsSchema.safeParse(details).success).toBe(true);
    expect(productDetailsSchema.safeParse({ ...details, html: "<b>" }).success).toBe(false);
    expect(
      productDetailsSchema.safeParse({ dimensions: { length: -1, unit: "cm" } }).success,
    ).toBe(false);
    expect(productDetailsSchema.safeParse({ dimensions: { length: 1, unit: "furlong" } }).success).toBe(false);
  });

  it("requires the manufacturer trio once a safety block exists", () => {
    expect(productDetailsSchema.safeParse({ safety: { manufacturerName: "X" } }).success).toBe(false);
    expect(
      productDetailsSchema.safeParse({
        safety: { manufacturerName: "X", manufacturerAddress: "Y", manufacturerEmail: "nope" },
      }).success,
    ).toBe(false);
  });

  it("caps the lists", () => {
    expect(
      productDetailsSchema.safeParse({ included: Array.from({ length: 21 }, () => "x") }).success,
    ).toBe(false);
    expect(
      productDetailsSchema.safeParse({
        specs: Array.from({ length: 31 }, () => ({ label: "a", value: "b" })),
      }).success,
    ).toBe(false);
  });
});

describe("documentSchema", () => {
  it("accepts a labelled document and refuses unknown keys or an overlong label", () => {
    expect(documentSchema.safeParse({ key: docKey(1), label: "CE Certificate" }).success).toBe(
      true,
    );
    expect(
      documentSchema.safeParse({ key: docKey(1), label: "CE Certificate", url: "https://x" })
        .success,
    ).toBe(false);
    expect(
      documentSchema.safeParse({ key: docKey(1), label: "x".repeat(81) }).success,
    ).toBe(false);
    expect(documentSchema.safeParse({ key: docKey(1), label: "" }).success).toBe(false);
  });
});

describe("the document upload kind", () => {
  it("is far tighter than the digital file it used to share a route with", () => {
    // The whole security case for splitting the kinds: a document is public
    // and unauthenticated the moment it is saved, so it may not inherit the
    // paid download's 200 MB cap or its twelve-type allowlist.
    expect(DOCUMENT_CONTENT_TYPES).toEqual(["application/pdf"]);
    expect(maxBytesForKind("document")).toBeLessThan(maxBytesForKind("file"));
    expect(maxBytesForKind("document")).toBe(DOCUMENT_MAX_BYTES);
    expect(isAllowedContentType("document", "application/pdf")).toBe(true);
    expect(isAllowedContentType("document", "application/pdf; charset=binary")).toBe(true);
    for (const bad of ["application/zip", "text/plain", "image/png", "text/html", null]) {
      expect(isAllowedContentType("document", bad), String(bad)).toBe(false);
    }
  });

  it("lives under its own prefix, so a manual and a paid download are never the same key", () => {
    expect(objectKeyPrefix("document")).toBe("documents");
    expect(objectKeyPrefix("document")).not.toBe(objectKeyPrefix("file"));
    const mine = `documents/${OWNER}/${OWNER.slice(0, 8)}-1111-4111-8111-000000000001-cert.pdf`;
    expect(isOwnedObjectKey(mine, "document", OWNER)).toBe(true);
    // Someone else's key, and the caller's own key under the wrong kind:
    // both refused, which is what keeps a document from being linked to a
    // product it does not belong to (or verified under the wrong caps).
    expect(isOwnedObjectKey(mine, "document", STRANGER)).toBe(false);
    expect(isOwnedObjectKey(mine, "file", OWNER)).toBe(false);
    expect(isOwnedObjectKey(docKey(1), "document", OWNER)).toBe(false);
    // Path tricks are still shut out by the key pattern.
    expect(isOwnedObjectKey(`documents/${OWNER}/../files/x.pdf`, "document", OWNER)).toBe(false);
  });

  it("refuses bytes that are not a PDF, whatever the file claims to be", () => {
    const bytes = (text: string) => new TextEncoder().encode(text.padEnd(16, "\0"));
    expect(sniffFile(bytes("%PDF-1.7"))).toBe("pdf");
    // A renamed zip, an HTML page, an executable: the document route accepts
    // only a positive `pdf`, so each of these is refused before it is stored.
    expect(sniffFile(new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(12).fill(0)]))).toBe("zip");
    expect(sniffFile(bytes("<!DOCTYPE html>"))).toBeNull();
    expect(sniffFile(new Uint8Array([0x4d, 0x5a, ...new Array(14).fill(0)]))).toBeNull();
  });
});

describe("productWriteSchema page members", () => {
  it("keeps every member optional (absent = keep stored)", () => {
    const parsed = productWriteSchema.safeParse(baseWrite);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.gallery).toBeUndefined();
      expect(parsed.data.optionGroups).toBeUndefined();
      expect(parsed.data.details).toBeUndefined();
      expect(parsed.data.documents).toBeUndefined();
      expect(parsed.data.purchaseUrl).toBeUndefined();
    }
  });

  it("caps the documents list", () => {
    expect(
      productWriteSchema.safeParse({
        ...baseWrite,
        documents: Array.from({ length: DOCUMENTS_MAX + 1 }, (_, i) => ({
          key: docKey(i),
          label: `Doc ${i}`,
        })),
      }).success,
    ).toBe(false);
    expect(
      productWriteSchema.safeParse({
        ...baseWrite,
        documents: [{ key: docKey(1), label: "Safety Data Sheet" }],
      }).success,
    ).toBe(true);
  });

  it("caps the gallery, the groups, the options per group and the total", () => {
    expect(
      productWriteSchema.safeParse({
        ...baseWrite,
        gallery: Array.from({ length: GALLERY_MAX + 1 }, (_, i) => ({ key: key(i), alt: "" })),
      }).success,
    ).toBe(false);
    expect(
      productWriteSchema.safeParse({
        ...baseWrite,
        optionGroups: Array.from({ length: OPTION_GROUPS_MAX + 1 }, (_, i) => group(i, 1)),
      }).success,
    ).toBe(false);
    expect(
      productWriteSchema.safeParse({
        ...baseWrite,
        optionGroups: [group(1, OPTIONS_PER_GROUP_MAX + 1)],
      }).success,
    ).toBe(false);
    // Under every per-group cap, over the total: the axis count and the option
    // count are separate budgets, and the page's cost is the second one.
    const perGroup = Math.ceil((OPTIONS_TOTAL_MAX + 1) / OPTION_GROUPS_MAX);
    expect(perGroup).toBeLessThanOrEqual(OPTIONS_PER_GROUP_MAX);
    expect(
      productWriteSchema.safeParse({
        ...baseWrite,
        optionGroups: Array.from({ length: OPTION_GROUPS_MAX }, (_, i) => group(i, perGroup)),
      }).success,
    ).toBe(false);
  });

  it("refuses a group with no options at all", () => {
    // An empty group would print a picker with nothing in it.
    expect(
      productWriteSchema.safeParse({ ...baseWrite, optionGroups: [group(1, 0)] }).success,
    ).toBe(false);
  });

  it("refuses ids repeated ANYWHERE in the option tree, not just within a group", () => {
    const duplicateWithinGroup = {
      ...group(1, 2),
      options: [
        { id: optionId(1), name: "Red", available: true },
        { id: optionId(1), name: "Blue", available: true },
      ],
    };
    expect(
      productWriteSchema.safeParse({ ...baseWrite, optionGroups: [duplicateWithinGroup] }).success,
    ).toBe(false);

    // The case a per-group check would miss: the same option id in two
    // different groups. A photo tie names an option id alone, so this has to
    // be refused or "which option is this" has two answers.
    const sharedId = [
      { ...group(1, 1), options: [{ id: optionId(7), name: "Red", available: true }] },
      { ...group(2, 1), options: [{ id: optionId(7), name: "Large", available: true }] },
    ];
    expect(productWriteSchema.safeParse({ ...baseWrite, optionGroups: sharedId }).success).toBe(
      false,
    );

    // And a group id colliding with an option id, for the same reason.
    const groupIdAsOption = [
      { ...group(1, 1), options: [{ id: groupId(1), name: "Red", available: true }] },
    ];
    expect(
      productWriteSchema.safeParse({ ...baseWrite, optionGroups: groupIdAsOption }).success,
    ).toBe(false);
  });

  it("refuses photos tied to unknown options and accepts a valid tie", () => {
    expect(
      productWriteSchema.safeParse({
        ...baseWrite,
        optionGroups: [
          { ...group(1, 1), options: [{ id: optionId(1), name: "Red", available: true }] },
        ],
        gallery: [{ key: key(1), alt: "Side", optionId: optionId(2) }],
      }).success,
    ).toBe(false);
    expect(
      productWriteSchema.safeParse({
        ...baseWrite,
        optionGroups: [
          {
            id: groupId(1),
            name: "Colour",
            display: "swatch",
            options: [{ id: optionId(1), name: "Red", swatch: "#ff0000", available: false }],
          },
        ],
        gallery: [{ key: key(1), alt: "Side", optionId: optionId(1) }],
        purchaseUrl: "https://shop.example.com/p/1",
      }).success,
    ).toBe(true);
  });

  it("refuses loose swatches, unknown displays and rows with extra keys", () => {
    expect(
      productWriteSchema.safeParse({
        ...baseWrite,
        optionGroups: [
          {
            ...group(1, 1),
            options: [{ id: optionId(1), name: "Red", swatch: "red", available: true }],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      productWriteSchema.safeParse({
        ...baseWrite,
        optionGroups: [{ ...group(1, 1), display: "carousel" }],
      }).success,
    ).toBe(false);
    expect(
      productWriteSchema.safeParse({
        ...baseWrite,
        optionGroups: [{ ...group(1, 1), price: 100 }],
      }).success,
    ).toBe(false);
    expect(
      productWriteSchema.safeParse({
        ...baseWrite,
        gallery: [{ key: key(1), alt: "", url: "https://evil.example/x.jpg" }],
      }).success,
    ).toBe(false);
  });
});

describe("read-side parsers", () => {
  it("degrade to empty on anything malformed", () => {
    expect(parseGallery("nope")).toEqual([]);
    expect(parseGallery([{ key: 1 }])).toEqual([]);
    expect(parseOptionGroups({ a: 1 })).toEqual([]);
    expect(parseOptionGroups([{ id: groupId(1), name: "Colour" }])).toEqual([]);
    expect(parseDetails(null)).toEqual({});
    expect(parseDetails({ materials: 42 })).toEqual({});
    expect(parseDocuments("nope")).toEqual([]);
    expect(parseDocuments([{ key: docKey(1) }])).toEqual([]);
  });

  it("keep the first of duplicated ids, across groups as well as within one", () => {
    // A write can never produce these, but a service-role seed or a
    // hand-edited row can, and an id that names two things resolves a photo
    // tie to whichever the reader happened to hit first.
    const groups = parseOptionGroups([
      {
        id: groupId(1),
        name: "Colour",
        display: "swatch",
        options: [
          { id: optionId(1), name: "Red", available: true },
          { id: optionId(1), name: "Blue", available: true },
        ],
      },
      {
        id: groupId(2),
        name: "Size",
        display: "chip",
        options: [
          { id: optionId(1), name: "Large", available: true },
          { id: optionId(2), name: "Small", available: true },
        ],
      },
      // Same group id again: dropped whole.
      { id: groupId(1), name: "Copy", display: "chip", options: [{ id: optionId(3), name: "X", available: true }] },
    ]);
    expect(groups.map((entry) => entry.name)).toEqual(["Colour", "Size"]);
    expect(groups[0]?.options.map((option) => option.name)).toEqual(["Red"]);
    expect(groups[1]?.options.map((option) => option.name)).toEqual(["Small"]);
  });

  it("trims over-long lists rather than dropping the whole tree", () => {
    // The public page presigns a URL per photo and paints a control per
    // option, so what an anonymous request can ask for has to be bounded by
    // the schema rather than by whatever is in the column.
    const groups = parseOptionGroups([group(1, OPTIONS_PER_GROUP_MAX + 5)]);
    expect(groups[0]?.options).toHaveLength(OPTIONS_PER_GROUP_MAX);
    expect(
      parseOptionGroups(Array.from({ length: OPTION_GROUPS_MAX + 3 }, (_, i) => group(i, 1))),
    ).toHaveLength(OPTION_GROUPS_MAX);
  });

  it("untie photos whose option is gone", () => {
    const gallery = reconcileGalleryOptions(
      [
        { key: key(1), alt: "a", optionId: optionId(1) },
        { key: key(2), alt: "b", optionId: optionId(9) },
      ],
      [
        {
          id: groupId(1),
          name: "Colour",
          display: "swatch",
          options: [{ id: optionId(1), name: "Red", available: true }],
        },
      ],
    );
    expect(gallery[1]).toEqual({ key: key(2), alt: "b" });
    expect(gallery[0]?.optionId).toBe(optionId(1));
  });
});
