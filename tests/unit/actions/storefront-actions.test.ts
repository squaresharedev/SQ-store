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
for (const m of ["from", "select", "insert", "update", "delete", "eq", "neq", "in"]) {
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

// ---- imports -------------------------------------------------------------

import {
  createStorefront,
  saveStorefront,
  updateEmbedSettings,
  deleteStorefront,
} from "@/lib/storefront/actions";
import { DEFAULT_STOREFRONT_CONFIG } from "@/types/storefront";

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

// Minimal valid theme matching storefrontConfigSchema strictObject requirements
const VALID_THEME = {
  background: { kind: "solid", color: "#ffffff" },
  accent: "#171717",
  font: "sans",
  radius: "none",
  cardStyle: "standard",
  priceDisplay: "always",
  cardShape: "rounded",
  priceTagPosition: "below",
  priceTagStyle: "plain",
  showTitle: true,
  displayMode: "grid",
  density: "comfy",
  soldOutBadge: false,
  hideSoldOut: false,
};

const VALID_CONFIG = { theme: VALID_THEME, blocks: [] };

function validSaveInput(overrides: Record<string, unknown> = {}) {
  return { name: "My Store", config: VALID_CONFIG, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbFn.mockResolvedValue({ data: null, error: null });
  for (const m of ["from", "select", "insert", "update", "delete", "eq", "neq", "in"]) {
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
    const result = await createStorefront("My Store");
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/permission/i);
    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe("createStorefront - happy path", () => {
  it("inserts with owner_id = accountId and returns the new id", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    dbFn.mockResolvedValueOnce({ data: { id: STOREFRONT_ID }, error: null });

    const result = await createStorefront("My Store");

    expect(result).toEqual({ ok: true, id: STOREFRONT_ID });
    const insertPayload = db.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(insertPayload.owner_id).toBe(OWNER_ID);
    expect(insertPayload.name).toBe("My Store");
  });

  it("falls back to 'Untitled storefront' when name is undefined", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    dbFn.mockResolvedValueOnce({ data: { id: STOREFRONT_ID }, error: null });

    await createStorefront(undefined);

    const insertPayload = db.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(insertPayload.name).toBe("Untitled storefront");
  });
});

// ==========================================================================
// saveStorefront
// ==========================================================================

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
    expect((result as { error: string }).error).toMatch(/permission/i);
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
        { type: "product", productId: OWNED_PRODUCT_ID, size: "1x1", order: 0 },
        { type: "product", productId: UNOWNED_PRODUCT_ID, size: "1x1", order: 1 },
      ],
    };
    // First dbFn call: ownership check (direct await on .in())
    dbFn.mockResolvedValueOnce({ data: [{ id: OWNED_PRODUCT_ID }], error: null });
    // Second dbFn call: the storefronts update
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
      blocks: [{ type: "product", productId: OWNED_PRODUCT_ID, size: "1x1", order: 0 }],
    };
    dbFn.mockResolvedValueOnce({ data: [{ id: OWNED_PRODUCT_ID }], error: null });
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

describe("saveStorefront - 0-row update", () => {
  it("returns 'Storefront not found.' when update matches no rows", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    dbFn.mockResolvedValueOnce({ data: null, error: null });

    const result = await saveStorefront(STOREFRONT_ID, validSaveInput());

    expect(result).toEqual({ ok: false, error: "Storefront not found." });
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
    expect((result as { error: string }).error).toMatch(/permission/i);
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

    expect(result).toEqual({ ok: false, error: "Storefront not found." });
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

    expect(result).toEqual({ ok: false, error: "Storefront not found." });
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
    expect((result as { error: string }).error).toMatch(/permission/i);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("success returns {ok:true}", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    dbFn.mockResolvedValueOnce({ data: { id: STOREFRONT_ID }, error: null });

    const result = await deleteStorefront(STOREFRONT_ID);

    expect(result).toEqual({ ok: true });
  });
});
