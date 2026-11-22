import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyUpload = vi.fn();
vi.mock("@/lib/storefront/uploads", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storefront/uploads")>()),
  verifyUpload: (...args: unknown[]) => verifyUpload(...args),
}));
vi.mock("@/lib/r2", () => ({ deleteObject: vi.fn(), headObject: vi.fn(), presignGetUrl: vi.fn() }));

const { addLogoKey, settleBandPhotos, settleLayout, storedLogoKey } = await import("@/lib/storefront/layout-save");
const { DEFAULT_STOREFRONT_CONFIG } = await import("@/types/storefront");
type Config = import("@/types/storefront").StorefrontConfig;

const OWN = "11111111-1111-4111-8111-111111111111";
const FOREIGN = "22222222-2222-4222-8222-222222222222";
const BAND = "33333333-3333-4333-8333-333333333333";

/** A Supabase stand-in answering the one storefront read with `rows`. */
function supabaseWith(rows: { id: string }[], error: unknown = null) {
  const query = {
    select: () => query,
    eq: () => query,
    in: (_column: string, ids: string[]) => Promise.resolve({ data: rows.filter((row) => ids.includes(row.id)), error }),
  };
  return { from: vi.fn(() => query) } as never;
}

function config(over: Partial<Config> = {}): Config {
  return { ...structuredClone(DEFAULT_STOREFRONT_CONFIG), ...over };
}

beforeEach(() => verifyUpload.mockReset().mockResolvedValue({ ok: true }));

describe("a save's links to other storefronts", () => {
  it("keeps the store's own, and drops a button or menu entry naming anyone else's", async () => {
    const saved = config({
      blocks: [
        { type: "button", id: "own", label: "Ours", link: { kind: "storefront", storefrontId: OWN }, x: 0, y: 0, w: 2, h: 1 },
        { type: "button", id: "foreign", label: "Theirs", link: { kind: "storefront", storefrontId: FOREIGN }, x: 2, y: 0, w: 2, h: 1 },
      ],
      header: { show: true, name: "", bio: "", links: [{ label: "Theirs", link: { kind: "storefront", storefrontId: FOREIGN } }] },
    });
    const supabase = supabaseWith([{ id: OWN }]);
    expect(await settleLayout(supabase, "owner", saved, undefined)).toEqual({ ok: true });
    expect(saved.blocks.map((block) => ("id" in block ? block.id : ""))).toEqual(["own"]);
    expect(saved.header).toEqual({ show: true, name: "", bio: "" });
  });

  it("reads nothing when no link names a storefront, and carries the bands in", async () => {
    const supabase = supabaseWith([]);
    const saved = config();
    const bands = [{ id: BAND, y: 0, h: 1, background: { kind: "solid" as const, color: "#000000" } }];
    await settleLayout(supabase, "owner", saved, bands);
    expect((supabase as unknown as { from: ReturnType<typeof vi.fn> }).from).not.toHaveBeenCalled();
    expect(saved.bands).toEqual(bands);
    const none = config();
    await settleLayout(supabase, "owner", none, []);
    expect("bands" in none).toBe(false);
  });

  it("fails the save, rather than guessing, when the check cannot be read", async () => {
    const saved = config({
      blocks: [{ type: "button", id: "own", label: "Ours", link: { kind: "storefront", storefrontId: OWN }, x: 0, y: 0, w: 2, h: 1 }],
    });
    const result = await settleLayout(supabaseWith([], { message: "down" }), "owner", saved, undefined);
    expect(result.ok).toBe(false);
  });
});

describe("a save's band photos", () => {
  const photo = (key: string) => ({ id: key, y: 0, h: 1, background: { kind: "image" as const, key, x: 50, y: 50, scale: 100 } });

  it("verifies only keys new to the storefront, and releases the ones let go of", async () => {
    const previous = { bands: [photo("images/u/old.jpg"), photo("images/u/kept.jpg")] };
    const next = config({ bands: [photo("images/u/kept.jpg"), photo("images/u/new.jpg")] });
    const result = await settleBandPhotos(previous, next, "u");
    expect(verifyUpload).toHaveBeenCalledTimes(1);
    expect(verifyUpload).toHaveBeenCalledWith("images/u/new.jpg", "image", "u");
    expect(result).toEqual({ ok: true, released: ["images/u/old.jpg"] });
  });

  it("never releases a photo the board still wears as its background", async () => {
    const next = config();
    next.theme = { ...next.theme, background: { kind: "image", key: "images/u/old.jpg", x: 50, y: 50, scale: 100 } };
    const result = await settleBandPhotos({ bands: [photo("images/u/old.jpg")] }, next, "u");
    expect(result).toEqual({ ok: true, released: [] });
  });

  it("refuses a key that fails its check", async () => {
    verifyUpload.mockResolvedValueOnce({ ok: false, error: { message: "nope" } });
    const result = await settleBandPhotos({}, config({ bands: [photo("images/x/stolen.jpg")] }), "u");
    expect(result.ok).toBe(false);
  });
});

describe("the header logo's key", () => {
  it("is read defensively off a stored config and joins the element keys", () => {
    expect(storedLogoKey({ header: { logo: { key: "elements/u/logo.svg" } } })).toBe("elements/u/logo.svg");
    expect(storedLogoKey({ header: { logo: { key: 3 } } })).toBeNull();
    expect(storedLogoKey(null)).toBeNull();
    const keys = new Set(["elements/u/a.png"]);
    addLogoKey(keys, { header: { logo: { key: "elements/u/logo.svg" } } });
    expect([...keys]).toEqual(["elements/u/a.png", "elements/u/logo.svg"]);
  });
});

describe("a save's links to products the save has dropped", () => {
  const GONE = "99999999-9999-4999-8999-999999999999";
  const KEPT = "88888888-8888-4888-8888-888888888888";

  it("drops a button and a menu entry whose product is no longer on the board, and keeps the rest", async () => {
    // What saveStorefront hands over once its ownership check has dropped the
    // block of a product that is not this store's (or was deleted meanwhile).
    const saved = config({
      blocks: [
        { type: "product", productId: KEPT, x: 0, y: 0, w: 2, h: 2 },
        { type: "button", id: "dead", label: "Gone", link: { kind: "product", productId: GONE }, x: 2, y: 0, w: 2, h: 1 },
        { type: "button", id: "live", label: "Here", link: { kind: "product", productId: KEPT }, x: 2, y: 1, w: 2, h: 1 },
        { type: "button", id: "band", label: "Up", link: { kind: "band", bandId: BAND }, x: 2, y: 2, w: 2, h: 1 },
      ],
      header: {
        show: true,
        name: "",
        bio: "",
        links: [
          { label: "Gone", link: { kind: "product", productId: GONE } },
          { label: "Here", link: { kind: "product", productId: KEPT } },
        ],
      },
    });
    const bands = [{ id: BAND, y: 0, h: 1, background: { kind: "solid" as const, color: "#000000" } }];
    expect(await settleLayout(supabaseWith([]), "owner", saved, bands)).toEqual({ ok: true });
    expect(saved.blocks.map((block) => ("id" in block ? block.id : "tile"))).toEqual(["tile", "live", "band"]);
    expect(saved.header?.links).toEqual([{ label: "Here", link: { kind: "product", productId: KEPT } }]);
  });
});
