// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- mocks ---------------------------------------------------------------

const getActiveAccountMock = vi.fn();
vi.mock("@/lib/team/account-context", () => ({
  getActiveAccount: () => getActiveAccountMock(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Chainable fake Supabase client.  db is also thenable to handle the
// ownership-check query that is awaited without .single()/.maybeSingle():
//   const { data, error } = await supabase.from("products").select("id").eq(...).in(...)
const dbFn = vi.fn();
const db: any = {};
// SF-03: added "like" for the name-deduplication query inside createStorefront.
for (const m of ["from", "select", "insert", "update", "delete", "eq", "neq", "in", "like"]) {
  db[m] = vi.fn(() => db);
}
db.single = vi.fn(() => dbFn());
db.maybeSingle = vi.fn(() => dbFn());
db.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
  Promise.resolve(dbFn()).then(resolve, reject);

// Non-thenable wrapper: createClient() resolves to this object, not db directly.
// If createClient returned db directly (async () => db), the Promise.resolve() in
// the async function would call db.then() (thenable protocol) and supabase would
// receive dbFn()'s resolved value instead of the chain object.
const clientWrapper = {
  from: (...args: unknown[]) => (db.from as (...a: unknown[]) => unknown)(...args),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => clientWrapper,
}));


// Rate limiting is exercised by its own tests; here it defaults to ALLOWED so
// these specs assert the action logic. Each file also has one case that flips
// it to denied, since the limiter fails closed and that path must be covered.
const rateLimitMock = vi.fn();
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  rateLimit: (...args: unknown[]) => rateLimitMock(...args),
}));

// ---- imports -------------------------------------------------------------

import {
  createStorefront,
  saveStorefront,
  updateEmbedSettings,
  deleteStorefront,
} from "@/lib/storefront/actions";
import { DEFAULT_STOREFRONT_CONFIG } from "@/types/storefront";
import { VIBE_PRESETS } from "@/lib/storefront/presets";

// ---- test constants ------------------------------------------------------

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const EDITOR_ID = "20000000-0000-4000-8000-000000000002";
const STOREFRONT_ID = "60000000-0000-4000-8000-000000000006";
const OWNED_PRODUCT_ID = "30000000-0000-4000-8000-000000000003";
const UNOWNED_PRODUCT_ID = "30000000-0000-4000-8000-000000000099";

function ownerAccount() {
  return { accountId: OWNER_ID, userId: OWNER_ID, role: "owner" as const, isOwner: true };
}
function viewerAccount() {
  return { accountId: OWNER_ID, userId: EDITOR_ID, role: "viewer" as const, isOwner: false };
}

// Valid theme matching storefrontConfigSchema's strictObject requirements.
// Derived from the shipped default so a new required field can't silently
// leave this fixture behind (it would fail as invalid_input, not not_found).
const VALID_THEME = {
  ...DEFAULT_STOREFRONT_CONFIG.theme,
  accent: "#171717",
  soldOutBadge: false,
};

const VALID_CONFIG = { theme: VALID_THEME, blocks: [] };

/** Read from the shipped preset so the assertion tracks the design, not a copy
 *  of it that would keep passing after someone retunes the vibe. */
const VIBE_BOLD = VIBE_PRESETS.bold;

function validSaveInput(overrides: Record<string, unknown> = {}) {
  return { name: "My Store", config: VALID_CONFIG, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitMock.mockResolvedValue(true);
  dbFn.mockResolvedValue({ data: null, error: null });
  for (const m of ["from", "select", "insert", "update", "delete", "eq", "neq", "in", "like"]) {
    db[m].mockReturnValue(db);
  }
  db.single.mockImplementation(() => dbFn());
  db.maybeSingle.mockImplementation(() => dbFn());
});

// ==========================================================================
// createStorefront
// ==========================================================================

describe("createStorefront - auth gates", () => {
  it("session expired returns {ok:false}", async () => {
    getActiveAccountMock.mockResolvedValue(null);
    const result = await createStorefront();
    expect(result.ok).toBe(false);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("viewer role returns permission error with no DB call", async () => {
    getActiveAccountMock.mockResolvedValue(viewerAccount());
    const result = await createStorefront({ name: "My Store" });
    expect(result.ok).toBe(false);
    expect((result as { error: { code: string } }).error.code).toBe("permission_denied");
    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe("createStorefront - happy path", () => {
  it("inserts with owner_id = accountId and returns the new id", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    // SF-03: first dbFn call is the name-dedup SELECT (db.then); second is insert .single().
    dbFn.mockResolvedValueOnce({ data: [], error: null }); // name check: no duplicates
    dbFn.mockResolvedValueOnce({ data: { id: STOREFRONT_ID }, error: null }); // insert

    const result = await createStorefront({ name: "My Store" });

    expect(result).toEqual({ ok: true, id: STOREFRONT_ID });
    const insertPayload = db.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(insertPayload.owner_id).toBe(OWNER_ID);
    expect(insertPayload.name).toBe("My Store");
  });

  it("falls back to 'Untitled storefront' when no input is given", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    // SF-03: name dedup check returns no duplicates, then insert succeeds.
    dbFn.mockResolvedValueOnce({ data: [], error: null }); // name check
    dbFn.mockResolvedValueOnce({ data: { id: STOREFRONT_ID }, error: null }); // insert

    await createStorefront(undefined);

    const insertPayload = db.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(insertPayload.name).toBe("Untitled storefront");
    // Skipping the setup flow is a first-class outcome, not an error.
    expect(insertPayload.brief).toEqual({});
    // SF-02/SF-03/SF-04: The initial config differs from DEFAULT_STOREFRONT_CONFIG:
    // it carries the wizard name in header.name and allowIndexing:true.
    const config = insertPayload.config as Record<string, unknown>;
    expect(config.theme).toMatchObject(DEFAULT_STOREFRONT_CONFIG.theme);
    expect((config.header as Record<string, unknown>).show).toBe(true);
    expect((config.productPage as Record<string, unknown>).allowIndexing).toBe(true);
  });

  it("SF-03: auto-suffixes name when a duplicate already exists", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    // Name check returns one match with the same name.
    dbFn.mockResolvedValueOnce({ data: [{ name: "My Store" }], error: null });
    dbFn.mockResolvedValueOnce({ data: { id: STOREFRONT_ID }, error: null });

    await createStorefront({ name: "My Store" });

    const insertPayload = db.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(insertPayload.name).toBe("My Store 2");
  });

  it("SF-03: seeds header.name from the wizard name", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    dbFn.mockResolvedValueOnce({ data: [], error: null });
    dbFn.mockResolvedValueOnce({ data: { id: STOREFRONT_ID }, error: null });

    await createStorefront({ name: "Craft Goods" });

    const insertPayload = db.insert.mock.calls[0][0] as Record<string, unknown>;
    const header = insertPayload.config as { header: { name: string } };
    expect(header.header.name).toBe("Craft Goods");
  });

  it("SF-04: new storefronts have allowIndexing:true", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    dbFn.mockResolvedValueOnce({ data: [], error: null });
    dbFn.mockResolvedValueOnce({ data: { id: STOREFRONT_ID }, error: null });

    await createStorefront({ name: "My Store" });

    const insertPayload = db.insert.mock.calls[0][0] as Record<string, unknown>;
    const config = insertPayload.config as { productPage: { allowIndexing: boolean } };
    expect(config.productPage.allowIndexing).toBe(true);
  });

  it("SF-06: digital fulfilment sets shippingNote to free-shipping", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    dbFn.mockResolvedValueOnce({ data: [], error: null });
    dbFn.mockResolvedValueOnce({ data: { id: STOREFRONT_ID }, error: null });

    await createStorefront({ name: "My Store", brief: { fulfilment: "digital" } });

    const insertPayload = db.insert.mock.calls[0][0] as Record<string, unknown>;
    const config = insertPayload.config as { productPage: { shippingNote: string } };
    expect(config.productPage.shippingNote).toBe("free-shipping");
  });

  it("SF-06: physical fulfilment keeps default shippingNote", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    dbFn.mockResolvedValueOnce({ data: [], error: null });
    dbFn.mockResolvedValueOnce({ data: { id: STOREFRONT_ID }, error: null });

    await createStorefront({ name: "My Store", brief: { fulfilment: "physical" } });

    const insertPayload = db.insert.mock.calls[0][0] as Record<string, unknown>;
    const config = insertPayload.config as { productPage: { shippingNote: string } };
    // Physical = shipping costs money; keep the default so buyers are not misled.
    expect(config.productPage.shippingNote).not.toBe("free-shipping");
  });
});

describe("createStorefront - the setup brief", () => {
  it("stores the answers and starts the storefront on the chosen vibe's theme", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    dbFn.mockResolvedValueOnce({ data: [], error: null }); // name check
    dbFn.mockResolvedValueOnce({ data: { id: STOREFRONT_ID }, error: null }); // insert

    await createStorefront({
      name: "Bold Store",
      brief: { category: "art", fulfilment: "physical", vibe: "bold" },
    });

    const insertPayload = db.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(insertPayload.brief).toEqual({
      category: "art",
      fulfilment: "physical",
      vibe: "bold",
    });
    // The one answer that does work immediately: the seller lands in a designer
    // already wearing the look they picked.
    const config = insertPayload.config as { theme: typeof VIBE_BOLD };
    expect(config.theme).toMatchObject(VIBE_BOLD);
  });

  it("keeps otherCategory only alongside category 'other'", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    dbFn.mockResolvedValueOnce({ data: [], error: null }); // name check
    dbFn.mockResolvedValueOnce({ data: { id: STOREFRONT_ID }, error: null }); // insert

    await createStorefront({
      brief: { category: "art", otherCategory: "model kits" },
    });

    const insertPayload = db.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(insertPayload.brief).toEqual({ category: "art" });
  });

  it("degrades a tampered brief to empty rather than failing the create", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    dbFn.mockResolvedValueOnce({ data: [], error: null }); // name check
    dbFn.mockResolvedValueOnce({ data: { id: STOREFRONT_ID }, error: null }); // insert

    const result = await createStorefront({
      brief: { vibe: "NOT_A_VIBE", category: "<script>" },
    });

    expect(result).toEqual({ ok: true, id: STOREFRONT_ID });
    const insertPayload = db.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(insertPayload.brief).toEqual({});
    // Config now carries header + productPage even with an empty brief.
    const config = insertPayload.config as Record<string, unknown>;
    expect(config.theme).toMatchObject(DEFAULT_STOREFRONT_CONFIG.theme);
    expect((config.productPage as Record<string, unknown>).allowIndexing).toBe(true);
  });

  it("ignores a non-object input instead of throwing", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    dbFn.mockResolvedValueOnce({ data: [], error: null }); // name check
    dbFn.mockResolvedValueOnce({ data: { id: STOREFRONT_ID }, error: null }); // insert

    const result = await createStorefront("My Store");

    expect(result).toEqual({ ok: true, id: STOREFRONT_ID });
    const insertPayload = db.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(insertPayload.name).toBe("Untitled storefront");
    expect(insertPayload.brief).toEqual({});
  });
});

// ==========================================================================
// saveStorefront
// ==========================================================================

describe("saveStorefront - rate limit", () => {
  it("refuses the save when the budget is spent, with no DB write", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    rateLimitMock.mockResolvedValue(false);

    const result = await saveStorefront(STOREFRONT_ID, validSaveInput());

    expect(result).toMatchObject({ ok: false, error: { code: "rate_limited" } });
    expect(db.update).not.toHaveBeenCalled();
  });

  it("checks the budget only after the role gate", async () => {
    getActiveAccountMock.mockResolvedValue(viewerAccount());
    await saveStorefront(STOREFRONT_ID, validSaveInput());
    expect(rateLimitMock).not.toHaveBeenCalled();
  });
});

describe("saveStorefront - auth gates", () => {
  it("session expired returns {ok:false}", async () => {
    getActiveAccountMock.mockResolvedValue(null);
    const result = await saveStorefront(STOREFRONT_ID, validSaveInput());
    expect(result.ok).toBe(false);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("viewer role returns permission error", async () => {
    getActiveAccountMock.mockResolvedValue(viewerAccount());
    const result = await saveStorefront(STOREFRONT_ID, validSaveInput());
    expect(result.ok).toBe(false);
    expect((result as { error: { code: string } }).error.code).toBe("permission_denied");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("invalid uuid id returns not-found error", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    const result = await saveStorefront("not-a-uuid", validSaveInput());
    expect(result.ok).toBe(false);
    expect(db.update).not.toHaveBeenCalled();
  });
});

describe("saveStorefront - validation", () => {
  it("invalid config (bad accent color) returns error, no DB write", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    const result = await saveStorefront(STOREFRONT_ID, {
      name: "My Store",
      config: { ...VALID_CONFIG, theme: { ...VALID_THEME, accent: "notacolor" } },
    });
    expect(result.ok).toBe(false);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("empty name returns error", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    const result = await saveStorefront(STOREFRONT_ID, { name: "", config: VALID_CONFIG });
    expect(result.ok).toBe(false);
    expect(db.update).not.toHaveBeenCalled();
  });
});

describe("saveStorefront - product block ownership check", () => {
  it("unowned product blocks are dropped; droppedBlocks reflects the count", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    const configWithMixedBlocks = {
      ...VALID_CONFIG,
      blocks: [
        { type: "product", productId: OWNED_PRODUCT_ID, x: 0, y: 0, w: 1, h: 1 },
        { type: "product", productId: UNOWNED_PRODUCT_ID, x: 1, y: 0, w: 1, h: 1 },
      ],
    };
    // First dbFn call: ownership check (direct await on .in())
    dbFn.mockResolvedValueOnce({ data: [{ id: OWNED_PRODUCT_ID }], error: null });
    // Second: the pre-save read of the existing row (drives image eviction).
    dbFn.mockResolvedValueOnce({ data: { config: VALID_CONFIG }, error: null });
    // Third: the storefronts update
    dbFn.mockResolvedValueOnce({ data: { id: STOREFRONT_ID }, error: null });

    const result = await saveStorefront(STOREFRONT_ID, {
      name: "My Store",
      config: configWithMixedBlocks,
    });

    expect(result).toMatchObject({ ok: true, droppedBlocks: 1 });
    // The update config must include only the owned block
    const updateArg = db.update.mock.calls[0][0] as { config: { blocks: { productId: string }[] } };
    const savedProductIds = updateArg.config.blocks.map((b) => b.productId);
    expect(savedProductIds).toContain(OWNED_PRODUCT_ID);
    expect(savedProductIds).not.toContain(UNOWNED_PRODUCT_ID);
  });

  it("all blocks owned -> droppedBlocks = 0", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    const configWithOneBlock = {
      ...VALID_CONFIG,
      blocks: [{ type: "product", productId: OWNED_PRODUCT_ID, x: 0, y: 0, w: 1, h: 1 }],
    };
    dbFn.mockResolvedValueOnce({ data: [{ id: OWNED_PRODUCT_ID }], error: null });
    dbFn.mockResolvedValueOnce({ data: { config: VALID_CONFIG }, error: null });
    dbFn.mockResolvedValueOnce({ data: { id: STOREFRONT_ID }, error: null });

    const result = await saveStorefront(STOREFRONT_ID, {
      name: "My Store",
      config: configWithOneBlock,
    });

    expect(result).toMatchObject({ ok: true, droppedBlocks: 0 });
  });
});

describe("saveStorefront - embed pass-through", () => {
  it("does not add embed to saved config when client did not send one", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    dbFn.mockResolvedValueOnce({ data: { id: STOREFRONT_ID }, error: null });

    await saveStorefront(STOREFRONT_ID, validSaveInput());

    const updateArg = db.update.mock.calls[0][0] as { config: Record<string, unknown> };
    expect(updateArg.config).not.toHaveProperty("embed");
  });

  it("preserves embed settings when the client passes them through", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    const embedSettings = { enabled: true, domains: ["example.com"] };
    dbFn.mockResolvedValueOnce({ data: { id: STOREFRONT_ID }, error: null });

    await saveStorefront(STOREFRONT_ID, {
      name: "My Store",
      config: { ...VALID_CONFIG, embed: embedSettings },
    });

    const updateArg = db.update.mock.calls[0][0] as { config: { embed: unknown } };
    expect(updateArg.config.embed).toEqual(embedSettings);
  });
});

describe("saveStorefront - shipping profiles", () => {
  const PROFILE = {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
    name: "Bulky items",
    dispatch: "Allow 3 weeks",
    body: "Pallet courier, ground floor only.",
  };

  it("REFUSES to persist profiles or policies, whatever the client sends", async () => {
    // The inverse of what this test used to assert, and the point of moving
    // the terms to the account. They are read by every storefront, so a save
    // from ONE designer must not be able to rewrite them: a stale client, or
    // a second tab open on another storefront, would otherwise clobber terms
    // it was never editing. The config is rebuilt field by field here, so an
    // unnamed member is dropped — and these two are deliberately unnamed.
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    dbFn.mockResolvedValueOnce({ data: { id: STOREFRONT_ID }, error: null });

    await saveStorefront(STOREFRONT_ID, {
      name: "My Store",
      config: {
        ...VALID_CONFIG,
        shippingProfiles: [PROFILE],
        policies: { shipping: "Ships in 3 days." },
      } as typeof VALID_CONFIG,
    });

    const updateArg = db.update.mock.calls[0][0] as { config: Record<string, unknown> };
    expect(updateArg.config).not.toHaveProperty("shippingProfiles");
    expect(updateArg.config).not.toHaveProperty("policies");
    // ...and the save still SUCCEEDS rather than rejecting the whole config:
    // a retired member is stripped, never a reason to fail a seller's save.
    expect(updateArg.config).toHaveProperty("theme");
  });
});

describe("saveStorefront - retired `seller` field", () => {
  it("strips a client-sent `seller` rather than persisting or rejecting it", async () => {
    // Trader identity moved to the account (lib/settings/seller-identity.ts).
    // A stale client (or a config saved before the move) may still send
    // `config.seller` — it must not end up in the write, and it must not
    // fail the save either.
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    // Two reads in sequence: the pre-save existence/upload-ownership check,
    // then the update itself — see the sibling "shipping profiles" tests'
    // own comment on this shape.
    dbFn.mockResolvedValueOnce({ data: { config: VALID_CONFIG }, error: null });
    dbFn.mockResolvedValueOnce({ data: { id: STOREFRONT_ID }, error: null });

    const result = await saveStorefront(STOREFRONT_ID, {
      name: "My Store",
      config: { ...VALID_CONFIG, seller: { businessName: "Old Co" } },
    });

    expect(result.ok).toBe(true);
    const updateArg = db.update.mock.calls[0][0] as { config: Record<string, unknown> };
    expect(updateArg.config).not.toHaveProperty("seller");
  });
});

describe("saveStorefront - 0-row update", () => {
  it("returns 'Storefront not found.' when update matches no rows", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    dbFn.mockResolvedValueOnce({ data: null, error: null });

    const result = await saveStorefront(STOREFRONT_ID, validSaveInput());

    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

// ==========================================================================
// updateEmbedSettings
// ==========================================================================

describe("updateEmbedSettings - auth gates", () => {
  it("session expired returns {ok:false}", async () => {
    getActiveAccountMock.mockResolvedValue(null);
    const result = await updateEmbedSettings(STOREFRONT_ID, { enabled: false, domains: [] });
    expect(result.ok).toBe(false);
  });

  it("viewer role returns permission error", async () => {
    getActiveAccountMock.mockResolvedValue(viewerAccount());
    const result = await updateEmbedSettings(STOREFRONT_ID, { enabled: false, domains: [] });
    expect(result.ok).toBe(false);
    expect((result as { error: { code: string } }).error.code).toBe("permission_denied");
  });
});

describe("updateEmbedSettings - validation", () => {
  it("invalid domain (contains protocol) is rejected before any DB write", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    const result = await updateEmbedSettings(STOREFRONT_ID, {
      enabled: true,
      domains: ["https://example.com"],
    });
    expect(result.ok).toBe(false);
    // read should not have been called
    expect(db.select).not.toHaveBeenCalled();
  });
});

describe("updateEmbedSettings - read-modify-write", () => {
  it("merges embed into stored config leaving theme and blocks unchanged", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    // First call: read stored config
    dbFn.mockResolvedValueOnce({ data: { config: DEFAULT_STOREFRONT_CONFIG }, error: null });
    // Second call: write updated config
    dbFn.mockResolvedValueOnce({ data: { id: STOREFRONT_ID }, error: null });

    const newEmbed = { enabled: true, domains: ["example.com", "shop.example.com"] };
    const result = await updateEmbedSettings(STOREFRONT_ID, newEmbed);

    expect(result).toEqual({ ok: true });
    const updateArg = db.update.mock.calls[0][0] as { config: Record<string, unknown> };
    expect(updateArg.config.embed).toEqual(newEmbed);
    // Theme from stored config must be preserved
    expect(updateArg.config.theme).toEqual(DEFAULT_STOREFRONT_CONFIG.theme);
    expect(updateArg.config.blocks).toEqual(DEFAULT_STOREFRONT_CONFIG.blocks);
  });

  it("returns not-found when read returns null row", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    dbFn.mockResolvedValueOnce({ data: null, error: null });

    const result = await updateEmbedSettings(STOREFRONT_ID, { enabled: false, domains: [] });

    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(db.update).not.toHaveBeenCalled();
  });
});

// ==========================================================================
// deleteStorefront
// ==========================================================================

describe("deleteStorefront", () => {
  it("invalid uuid id returns error before any DB call", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    const result = await deleteStorefront("not-a-uuid");
    expect(result.ok).toBe(false);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("0 rows deleted returns 'Storefront not found.'", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    dbFn.mockResolvedValueOnce({ data: null, error: null });

    const result = await deleteStorefront(STOREFRONT_ID);

    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  it("session expired returns {ok:false}", async () => {
    getActiveAccountMock.mockResolvedValue(null);
    const result = await deleteStorefront(STOREFRONT_ID);
    expect(result.ok).toBe(false);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("viewer role returns permission error", async () => {
    getActiveAccountMock.mockResolvedValue(viewerAccount());
    const result = await deleteStorefront(STOREFRONT_ID);
    expect(result.ok).toBe(false);
    expect((result as { error: { code: string } }).error.code).toBe("permission_denied");
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("success returns {ok:true}", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    dbFn.mockResolvedValueOnce({ data: { id: STOREFRONT_ID }, error: null });

    const result = await deleteStorefront(STOREFRONT_ID);

    expect(result).toEqual({ ok: true });
  });
});
