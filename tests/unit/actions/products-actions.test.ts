// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- mocks ---------------------------------------------------------------

const getActiveAccountMock = vi.fn();
vi.mock("@/lib/team/account-context", () => ({
  getActiveAccount: () => getActiveAccountMock(),
}));

const headObjectMock = vi.fn();
const deleteObjectMock = vi.fn();
vi.mock("@/lib/r2", () => ({
  headObject: (key: string) => headObjectMock(key),
  deleteObject: (key: string) => deleteObjectMock(key),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Chainable fake Supabase client.
// - All chain methods (from/select/insert/update/delete/eq/neq/in) return db.
// - Terminal methods (single/maybeSingle) call dbFn() so each test can
//   configure results via mockResolvedValueOnce.
// - db is thenable so "await db" (direct-await, no .single) also works.
//
// IMPORTANT: createClient MUST return a non-thenable wrapper (clientWrapper).
// If it returned db directly, "async () => db" would unwrap the thenable and
// supabase would receive dbFn()'s value instead of the chain object.
const dbFn = vi.fn();
const db: any = {};
for (const m of ["from", "select", "insert", "update", "delete", "eq", "neq", "in"]) {
  db[m] = vi.fn(() => db);
}
db.single = vi.fn(() => dbFn());
db.maybeSingle = vi.fn(() => dbFn());
db.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
  Promise.resolve(dbFn()).then(resolve, reject);

// Non-thenable wrapper: createClient() resolves to this, not db directly.
const clientWrapper = {
  from: (...args: unknown[]) => (db.from as (...a: unknown[]) => unknown)(...args),
  auth: db.auth,
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => clientWrapper,
}));

// ---- imports -------------------------------------------------------------

import { createProduct, updateProduct, deleteProduct } from "@/lib/products/actions";
import { IMAGE_MAX_BYTES } from "@/lib/validation/product";

// ---- test constants ------------------------------------------------------

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const EDITOR_ID = "20000000-0000-4000-8000-000000000002";
const PRODUCT_ID = "30000000-0000-4000-8000-000000000003";
const KEY_UUID_A = "00000000-0000-4000-8000-aaaaaaaaaaaa";
const KEY_UUID_B = "00000000-0000-4000-8000-bbbbbbbbbbbb";

const ownedImageKey = `images/${OWNER_ID}/${KEY_UUID_A}-photo.png`;
const otherOwnerImageKey = `images/${EDITOR_ID}/${KEY_UUID_A}-photo.png`;
const oldImageKey = `images/${OWNER_ID}/${KEY_UUID_B}-old.png`;

function ownerAccount() {
  return { accountId: OWNER_ID, userId: OWNER_ID, role: "owner" as const, isOwner: true };
}
function viewerAccount() {
  return { accountId: OWNER_ID, userId: EDITOR_ID, role: "viewer" as const, isOwner: false };
}

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    title: "Test Product",
    description: "A description",
    priceCents: 1000,
    currency: "EUR",
    status: "active",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbFn.mockResolvedValue({ data: null, error: null });
  deleteObjectMock.mockResolvedValue(undefined);
  headObjectMock.mockResolvedValue({ size: 512, contentType: "image/png" });
  for (const m of ["from", "select", "insert", "update", "delete", "eq", "neq", "in"]) {
    (db[m] as ReturnType<typeof vi.fn>).mockReturnValue(db);
  }
  db.single.mockImplementation(() => dbFn());
  db.maybeSingle.mockImplementation(() => dbFn());
});

// ==========================================================================
// createProduct
// ==========================================================================

describe("createProduct - auth gates", () => {
  it("session expired returns {ok:false} with no supabase call", async () => {
    getActiveAccountMock.mockResolvedValue(null);
    const result = await createProduct(validInput());
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(/session/i);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("viewer role returns permission error with no DB write and no headObject call", async () => {
    getActiveAccountMock.mockResolvedValue(viewerAccount());
    const result = await createProduct(validInput());
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/permission/i);
    expect(db.insert).not.toHaveBeenCalled();
    expect(headObjectMock).not.toHaveBeenCalled();
  });
});

describe("createProduct - validation", () => {
  it("rejects invalid payload (price = 0) with 'Invalid product data.'", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    const result = await createProduct(validInput({ priceCents: 0 }));
    expect(result).toEqual({ ok: false, error: "Invalid product data." });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rejects negative price", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    const result = await createProduct(validInput({ priceCents: -5 }));
    expect(result).toEqual({ ok: false, error: "Invalid product data." });
  });

  it("imageKey under a different user prefix returns 'Invalid image reference.' with no headObject call", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    const result = await createProduct(validInput({ imageKey: otherOwnerImageKey }));
    expect(result).toEqual({ ok: false, error: "Invalid image reference." });
    expect(headObjectMock).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe("createProduct - object verification", () => {
  it("headObject returning null (upload never finished) returns error about upload", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    headObjectMock.mockResolvedValue(null);
    const result = await createProduct(validInput({ imageKey: ownedImageKey }));
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/did not finish/i);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("oversized image (>10 MB) evicted via deleteObject and returns 'too large' error", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    headObjectMock.mockResolvedValue({ size: IMAGE_MAX_BYTES + 1, contentType: "image/png" });
    const result = await createProduct(validInput({ imageKey: ownedImageKey }));
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/too large/i);
    expect(deleteObjectMock).toHaveBeenCalledWith(ownedImageKey);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("wrong contentType evicted and returns 'not supported' error", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    headObjectMock.mockResolvedValue({ size: 1024, contentType: "text/html" });
    const result = await createProduct(validInput({ imageKey: ownedImageKey }));
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/not supported/i);
    expect(deleteObjectMock).toHaveBeenCalledWith(ownedImageKey);
    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe("createProduct - happy path", () => {
  it("inserts with owner_id = accountId (not userId) and returns new id", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    dbFn.mockResolvedValueOnce({ data: { id: PRODUCT_ID }, error: null });

    const result = await createProduct(validInput({ imageKey: ownedImageKey }));

    expect(result).toEqual({ ok: true, id: PRODUCT_ID });
    const insertPayload = db.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(insertPayload.owner_id).toBe(OWNER_ID);
  });

  it("stock_quantity is null when trackStock is false, even if stockQuantity was supplied", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    dbFn.mockResolvedValueOnce({ data: { id: PRODUCT_ID }, error: null });

    await createProduct(validInput({ trackStock: false, stockQuantity: 99 }));

    const insertPayload = db.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(insertPayload.track_stock).toBe(false);
    expect(insertPayload.stock_quantity).toBeNull();
  });

  it("stock_quantity is stored when trackStock is true", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    dbFn.mockResolvedValueOnce({ data: { id: PRODUCT_ID }, error: null });

    await createProduct(validInput({ trackStock: true, stockQuantity: 42 }));

    const insertPayload = db.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(insertPayload.track_stock).toBe(true);
    expect(insertPayload.stock_quantity).toBe(42);
  });
});

// ==========================================================================
// updateProduct
// ==========================================================================

describe("updateProduct - three-state image key", () => {
  it("imageKey absent from payload leaves image_key out of the update object", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    // No replacingImage/File: only one maybeSingle call (the update).
    dbFn.mockResolvedValueOnce({ data: { id: PRODUCT_ID }, error: null });

    const result = await updateProduct(PRODUCT_ID, validInput());

    expect(result).toEqual({ ok: true, id: PRODUCT_ID });
    const updatePayload = db.update.mock.calls[0][0] as Record<string, unknown>;
    expect(updatePayload).not.toHaveProperty("image_key");
  });

  it("imageKey null clears the stored key (sets image_key=null in update)", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    // replacingImage=true: read old keys then update (two maybeSingle calls).
    dbFn.mockResolvedValueOnce({ data: { image_key: oldImageKey, digital_file_key: null }, error: null });
    dbFn.mockResolvedValueOnce({ data: { id: PRODUCT_ID }, error: null });

    const result = await updateProduct(PRODUCT_ID, validInput({ imageKey: null }));

    expect(result).toEqual({ ok: true, id: PRODUCT_ID });
    const updatePayload = db.update.mock.calls[0][0] as Record<string, unknown>;
    expect(updatePayload).toHaveProperty("image_key", null);
  });

  it("replacing image evicts the OLD key after a successful write", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    dbFn.mockResolvedValueOnce({
      data: { image_key: oldImageKey, digital_file_key: null },
      error: null,
    });
    dbFn.mockResolvedValueOnce({ data: { id: PRODUCT_ID }, error: null });

    const result = await updateProduct(PRODUCT_ID, validInput({ imageKey: ownedImageKey }));

    expect(result).toEqual({ ok: true, id: PRODUCT_ID });
    expect(deleteObjectMock).toHaveBeenCalledWith(oldImageKey);
    expect(deleteObjectMock).not.toHaveBeenCalledWith(ownedImageKey);
  });

  it("0 rows updated returns 'Product not found.' with no eviction", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    // No imageKey: single maybeSingle for the update, returning null (not found).
    dbFn.mockResolvedValueOnce({ data: null, error: null });

    const result = await updateProduct(PRODUCT_ID, validInput());

    expect(result).toEqual({ ok: false, error: "Product not found." });
    expect(deleteObjectMock).not.toHaveBeenCalled();
  });

  it("session expired returns {ok:false} with no DB write", async () => {
    getActiveAccountMock.mockResolvedValue(null);
    const result = await updateProduct(PRODUCT_ID, validInput());
    expect(result.ok).toBe(false);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("viewer role returns permission error", async () => {
    getActiveAccountMock.mockResolvedValue(viewerAccount());
    const result = await updateProduct(PRODUCT_ID, validInput());
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/permission/i);
    expect(db.update).not.toHaveBeenCalled();
  });
});

// ==========================================================================
// deleteProduct
// ==========================================================================

describe("deleteProduct", () => {
  it("session expired returns {ok:false} with no DB call", async () => {
    getActiveAccountMock.mockResolvedValue(null);
    const result = await deleteProduct(PRODUCT_ID);
    expect(result.ok).toBe(false);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("viewer role returns permission error with no DB call", async () => {
    getActiveAccountMock.mockResolvedValue(viewerAccount());
    const result = await deleteProduct(PRODUCT_ID);
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/permission/i);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("0 rows deleted returns 'Product not found.'", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    dbFn.mockResolvedValueOnce({ data: null, error: null });

    const result = await deleteProduct(PRODUCT_ID);

    expect(result).toEqual({ ok: false, error: "Product not found." });
    expect(deleteObjectMock).not.toHaveBeenCalled();
  });

  it("success evicts both image_key and digital_file_key", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    const imgKey = `images/${OWNER_ID}/${KEY_UUID_A}-photo.png`;
    const fileKey = `files/${OWNER_ID}/${KEY_UUID_A}-archive.zip`;
    dbFn.mockResolvedValueOnce({
      data: { id: PRODUCT_ID, image_key: imgKey, digital_file_key: fileKey },
      error: null,
    });

    const result = await deleteProduct(PRODUCT_ID);

    expect(result).toEqual({ ok: true, id: PRODUCT_ID });
    expect(deleteObjectMock).toHaveBeenCalledWith(imgKey);
    expect(deleteObjectMock).toHaveBeenCalledWith(fileKey);
    expect(deleteObjectMock).toHaveBeenCalledTimes(2);
  });

  it("null stored keys are not passed to deleteObject", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    dbFn.mockResolvedValueOnce({
      data: { id: PRODUCT_ID, image_key: null, digital_file_key: null },
      error: null,
    });

    await deleteProduct(PRODUCT_ID);

    expect(deleteObjectMock).not.toHaveBeenCalled();
  });
});
