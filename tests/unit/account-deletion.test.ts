/**
 * Account deletion, the parts that are rules rather than I/O:
 *
 *   - WHEN (lib/account-deletion/policy.ts): the seller's waiting period, and
 *     what in their orders holds a deletion for the sake of a buyer;
 *   - WHICH FILES (object-keys.ts): found by the shape of an object key,
 *     wherever in a row it sits, and nothing that merely resembles one;
 *   - WHO MAY START IT (lib/ops/cron.ts): only the holder of the secret.
 *
 * The job itself, against a database and the auth server, is
 * tests/e2e/89-account-deletion.spec.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_DELETION_GRACE_DAYS,
  DELETION_RETRY_HOURS,
  ORDER_AFTERCARE_DAYS,
  aftercareCutoff,
  deletionDueAt,
  deletionOutlook,
  deletionResting,
  dueCutoff,
  type DeletionOrderFacts,
} from "@/lib/account-deletion/policy";
import { collectObjectKeys, isObjectKey } from "@/lib/account-deletion/object-keys";
import { cronAuthorized } from "@/lib/ops/cron";

const NOTHING_OWED: DeletionOrderFacts = { toShip: 0, pending: 0, disputed: 0, lastSaleAt: null, lastShippedAt: null };
const REQUESTED = "2026-10-01T12:00:00.000Z";
const day = (iso: string) => new Date(iso);

describe("when an account is deleted", () => {
  it("waits the grace period from the request, to the minute", () => {
    expect(ACCOUNT_DELETION_GRACE_DAYS).toBe(14);
    expect(deletionDueAt(REQUESTED).toISOString()).toBe("2026-10-15T12:00:00.000Z");
    expect(deletionOutlook(REQUESTED, NOTHING_OWED, day("2026-10-15T11:59:59Z")).ready).toBe(false);
    expect(deletionOutlook(REQUESTED, NOTHING_OWED, day("2026-10-15T12:00:00Z")).ready).toBe(true);
  });

  it.each([
    ["a parcel is owed", { toShip: 1 }, "toShip"],
    ["a payment is in flight", { pending: 1 }, "paymentPending"],
    ["a payment is disputed", { disputed: 2 }, "disputed"],
  ] as const)("holds, however long ago it was asked for, while %s", (_why, facts, hold) => {
    const outlook = deletionOutlook(REQUESTED, { ...NOTHING_OWED, ...facts }, day("2027-01-01T00:00:00Z"));
    expect(outlook.holds).toEqual([hold]);
    expect(outlook.ready).toBe(false);
  });

  it("holds for 30 days after the last sale, so a buyer's order page outlives their rights on it", () => {
    expect(ORDER_AFTERCARE_DAYS).toBe(30);
    const facts = { ...NOTHING_OWED, lastSaleAt: "2026-10-10T08:00:00.000Z" };
    const during = deletionOutlook(REQUESTED, facts, day("2026-10-20T00:00:00Z"));
    expect(during.holds).toEqual(["recentSale"]);
    expect(during.aftercareEndsAt?.toISOString()).toBe("2026-11-09T08:00:00.000Z");
    expect(during.ready).toBe(false);

    const after = deletionOutlook(REQUESTED, facts, day("2026-11-09T08:00:00Z"));
    expect(after.holds).toEqual([]);
    expect(after.aftercareEndsAt).toBeNull();
    expect(after.ready).toBe(true);
  });

  it("counts the 30 days from the dispatch when that came later, so a made-to-order buyer keeps their whole withdrawal period", () => {
    // Sold on 1 October, shipped three weeks later: the window runs from the
    // dispatch, not from the sale.
    const facts = { ...NOTHING_OWED, lastSaleAt: "2026-10-01T09:00:00.000Z", lastShippedAt: "2026-10-22T15:00:00.000Z" };
    const pastTheSale = deletionOutlook(REQUESTED, facts, day("2026-11-05T00:00:00Z"));
    expect(pastTheSale.holds).toEqual(["recentSale"]);
    expect(pastTheSale.aftercareEndsAt?.toISOString()).toBe("2026-11-21T15:00:00.000Z");

    expect(deletionOutlook(REQUESTED, facts, day("2026-11-21T15:00:00Z")).ready).toBe(true);
  });

  it("counts from the sale when a dispatch came before a newer sale", () => {
    const facts = { ...NOTHING_OWED, lastSaleAt: "2026-10-12T00:00:00.000Z", lastShippedAt: "2026-10-05T00:00:00.000Z" };
    expect(deletionOutlook(REQUESTED, facts, day("2026-10-20T00:00:00Z")).aftercareEndsAt?.toISOString()).toBe(
      "2026-11-11T00:00:00.000Z",
    );
  });

  it("names every hold at once, most pressing first", () => {
    const outlook = deletionOutlook(
      REQUESTED,
      { toShip: 3, pending: 1, disputed: 1, lastSaleAt: "2026-10-14T00:00:00Z", lastShippedAt: null },
      day("2026-10-16T00:00:00Z"),
    );
    expect(outlook.holds).toEqual(["toShip", "paymentPending", "disputed", "recentSale"]);
  });

  it("gives the job the same two cutoffs the page shows as dates", () => {
    const now = day("2026-10-31T00:00:00Z");
    expect(dueCutoff(now).toISOString()).toBe("2026-10-17T00:00:00.000Z");
    expect(aftercareCutoff(now).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("rests a deletion that failed, so the one behind it is not kept waiting, and tries it again the next day", () => {
    const failedAt = "2026-10-20T03:23:00.000Z";
    const hoursLater = (hours: number) => new Date(new Date(failedAt).getTime() + hours * 60 * 60 * 1000);
    // The scheduler calls again within seconds: the failed one is passed over.
    expect(deletionResting(failedAt, "files", hoursLater(0))).toBe(true);
    expect(deletionResting(failedAt, "files", hoursLater(DELETION_RETRY_HOURS - 1))).toBe(true);
    // The rest is over by the next daily run.
    expect(DELETION_RETRY_HOURS).toBeLessThan(24);
    expect(deletionResting(failedAt, "files", hoursLater(DELETION_RETRY_HOURS))).toBe(false);
    expect(deletionResting(failedAt, "files", hoursLater(24))).toBe(false);
    // Never attempted, or attempted without failing: nothing to rest from.
    expect(deletionResting(null, null, hoursLater(0))).toBe(false);
    expect(deletionResting(failedAt, null, hoursLater(0))).toBe(false);
  });
});

const OWNER = "5f0c4d0e-6c2b-4f0e-9a43-0d6a0a7b1c11";
const FILE = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const key = (prefix: string, name = "vase.png") => `${prefix}/${OWNER}/${FILE}-${name}`;

describe("which files a row points at", () => {
  it("knows an object key by its shape, for every kind of upload", () => {
    for (const prefix of ["images", "files", "fonts", "elements", "documents"]) {
      expect(isObjectKey(key(prefix))).toBe(true);
    }
  });

  it.each([
    ["another folder", `avatars/${OWNER}/${FILE}-me.png`],
    ["a URL that contains one", `https://r2.example/${key("images")}`],
    ["a path that climbs out", `images/${OWNER}/../${FILE}-x.png`],
    ["no uploader", `images/${FILE}-x.png`],
    ["a sentence", "images of the vase"],
    ["not a string", 42],
  ])("leaves %s alone", (_what, value) => {
    expect(isObjectKey(value)).toBe(false);
  });

  it("finds keys wherever they sit in a row, each once", () => {
    const product = {
      id: "p1",
      title: "Stoneware vase",
      image_key: key("images"),
      digital_file_key: key("files", "pattern.pdf"),
      gallery: [{ key: key("images", "side.png"), alt: "From the side" }, { key: key("images") }],
      documents: [{ title: "Care", key: key("documents", "care.pdf") }],
      price_cents: 2400,
      nothing: null,
    };
    expect([...collectObjectKeys(product)].sort()).toEqual(
      [key("documents", "care.pdf"), key("files", "pattern.pdf"), key("images", "side.png"), key("images")].sort(),
    );
  });

  it("reads a storefront's design the same way: background, font, image blocks, page photos", () => {
    const config = {
      theme: {
        background: { kind: "image", key: key("images", "bg.jpg") },
        customFont: { key: key("fonts", "serif.woff2"), name: "Serif" },
      },
      blocks: [
        { type: "image", id: "b1", key: key("elements", "logo.svg") },
        { type: "text", id: "b2", text: "images/are/nice" },
      ],
      productPage: { backgroundImage: { key: key("images", "page.jpg") } },
    };
    expect(collectObjectKeys(config).size).toBe(4);
  });
});

describe("who may start a scheduled job", () => {
  afterEach(() => vi.unstubAllEnvs());
  const SECRET = "a-long-random-scheduler-secret-0123456789";
  const call = (authorization?: string) =>
    cronAuthorized(new Request("https://app.example/api/cron/x", { method: "POST", headers: authorization ? { authorization } : {} }));

  it("the holder of the secret, and nobody else", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    expect(await call(`Bearer ${SECRET}`)).toBe(true);
    expect(await call(`Bearer ${SECRET}x`)).toBe(false);
    expect(await call(`Bearer ${SECRET.slice(0, -1)}`)).toBe(false);
    expect(await call(SECRET)).toBe(false);
    expect(await call("Bearer ")).toBe(false);
    expect(await call()).toBe(false);
  });

  it("nobody at all while no secret is set, or one too short to be a secret", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(await call("Bearer ")).toBe(false);
    vi.stubEnv("CRON_SECRET", "short");
    expect(await call("Bearer short")).toBe(false);
  });
});
