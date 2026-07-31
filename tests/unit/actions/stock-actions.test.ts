// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- mocks ---------------------------------------------------------------

const getActiveAccountMock = vi.fn();
vi.mock("@/lib/team/account-context", () => ({
  getActiveAccount: () => getActiveAccountMock(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Chainable fake Supabase client
const dbFn = vi.fn();
const db: any = {};
for (const m of ["from", "select", "insert", "update", "delete", "eq", "neq", "in"]) {
  db[m] = vi.fn(() => db);
}
db.maybeSingle = vi.fn(() => dbFn());
db.single = vi.fn(() => dbFn());

// Non-thenable wrapper: prevents async () => db from unwrapping via thenable protocol.
const clientWrapper = {
  from: (...args: unknown[]) => (db.from as (...a: unknown[]) => unknown)(...args),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => clientWrapper,
}));

// ---- imports -------------------------------------------------------------

import { updateStockSettings } from "@/lib/stock/actions";
import { STOCK_QUANTITY_MAX } from "@/lib/validation/product";

// ---- test constants ------------------------------------------------------

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const EDITOR_ID = "20000000-0000-4000-8000-000000000002";
const PRODUCT_ID = "30000000-0000-4000-8000-000000000003";

function ownerAccount() {
  return { accountId: OWNER_ID, userId: OWNER_ID, role: "owner" as const, isOwner: true };
}
function viewerAccount() {
  return { accountId: OWNER_ID, userId: EDITOR_ID, role: "viewer" as const, isOwner: false };
}

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    trackStock: false,
    stockQuantity: null,
    lowStockThreshold: 5,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbFn.mockResolvedValue({ data: null, error: null });
  for (const m of ["from", "select", "insert", "update", "delete", "eq", "neq", "in"]) {
    db[m].mockReturnValue(db);
  }
  db.maybeSingle.mockImplementation(() => dbFn());
  db.single.mockImplementation(() => dbFn());
});

// ==========================================================================
// updateStockSettings
// ==========================================================================

describe("updateStockSettings - auth gates", () => {
  it("session expired returns {ok:false} with no DB call", async () => {
    getActiveAccountMock.mockResolvedValue(null);
    const result = await updateStockSettings(PRODUCT_ID, validInput());
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: { code: string } }).error.code).toBe("session_expired");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("viewer role returns permission error with no DB call", async () => {
    getActiveAccountMock.mockResolvedValue(viewerAccount());
    const result = await updateStockSettings(PRODUCT_ID, validInput());
    expect(result.ok).toBe(false);
    expect((result as { error: { code: string } }).error.code).toBe("permission_denied");
    expect(db.update).not.toHaveBeenCalled();
  });
});

describe("updateStockSettings - productId validation", () => {
  it("invalid productId (non-UUID) returns 'Product not found.' before DB call", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    const result = await updateStockSettings("not-a-uuid", validInput());
    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(db.update).not.toHaveBeenCalled();
  });

  it("SQL-injection-style productId is rejected before DB call", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    const result = await updateStockSettings("1; drop table products;--", validInput());
    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(db.update).not.toHaveBeenCalled();
  });
});

describe("updateStockSettings - stock settings validation", () => {
  it("trackStock true without a quantity returns 'Invalid stock settings.'", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    const result = await updateStockSettings(PRODUCT_ID, {
      trackStock: true,
      stockQuantity: null, // missing quantity
      lowStockThreshold: 5,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(db.update).not.toHaveBeenCalled();
  });

  it("trackStock true with stockQuantity undefined returns error", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    const result = await updateStockSettings(PRODUCT_ID, {
      trackStock: true,
      lowStockThreshold: 5,
      // stockQuantity absent
    });
    expect(result.ok).toBe(false);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("stockQuantity exceeding STOCK_QUANTITY_MAX is rejected", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    const result = await updateStockSettings(PRODUCT_ID, {
      trackStock: true,
      stockQuantity: STOCK_QUANTITY_MAX + 1,
      lowStockThreshold: 5,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(db.update).not.toHaveBeenCalled();
  });

  it("negative stockQuantity is rejected", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    const result = await updateStockSettings(PRODUCT_ID, {
      trackStock: true,
      stockQuantity: -1,
      lowStockThreshold: 5,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });
});

describe("updateStockSettings - DB write behavior", () => {
  it("trackStock false writes stock_quantity = null (clears stale inventory)", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    dbFn.mockResolvedValueOnce({ data: { id: PRODUCT_ID }, error: null });

    const result = await updateStockSettings(
      PRODUCT_ID,
      validInput({ trackStock: false, stockQuantity: 42 }), // quantity provided but should be cleared
    );

    expect(result).toEqual({ ok: true });
    const updatePayload = db.update.mock.calls[0][0] as Record<string, unknown>;
    expect(updatePayload.track_stock).toBe(false);
    expect(updatePayload.stock_quantity).toBeNull();
  });

  it("trackStock true stores the provided stockQuantity", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    dbFn.mockResolvedValueOnce({ data: { id: PRODUCT_ID }, error: null });

    await updateStockSettings(
      PRODUCT_ID,
      validInput({ trackStock: true, stockQuantity: 100 }),
    );

    const updatePayload = db.update.mock.calls[0][0] as Record<string, unknown>;
    expect(updatePayload.track_stock).toBe(true);
    expect(updatePayload.stock_quantity).toBe(100);
  });

  it("update is scoped to the active accountId (owner_id filter)", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    dbFn.mockResolvedValueOnce({ data: { id: PRODUCT_ID }, error: null });

    await updateStockSettings(PRODUCT_ID, validInput());

    const eqCalls = db.eq.mock.calls as [string, string][];
    expect(eqCalls.some(([col, val]) => col === "owner_id" && val === OWNER_ID)).toBe(true);
  });

  it("0 rows updated (product not found for this owner) returns 'Product not found.'", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    dbFn.mockResolvedValueOnce({ data: null, error: null });

    const result = await updateStockSettings(PRODUCT_ID, validInput());

    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});
