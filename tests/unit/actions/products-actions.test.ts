// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { english } from "../../setup/translate";
import { traderIdentityRequired, type ActionError } from "@/lib/errors";

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

// The automatic content check has its own suites (tests/unit/auto-moderation,
// tests/integration/37-auto-moderation). Here it is a pair of spies, so these
// specs can assert WHEN a save calls it: before the write, and after.
const precheckMock = vi.fn(async (..._args: unknown[]) => {});
const settleMock = vi.fn(async (..._args: unknown[]) => "ok");
// A badge's own verdict, keyed by its words; clean unless a spec says not.
const badgeVerdicts = new Map<string, unknown>();
const badgeTextMock = vi.fn(async (label: string) =>
  badgeVerdicts.has(label) ? badgeVerdicts.get(label) : { verdict: "clean", ground: null, paths: [] },
);
vi.mock("@/lib/moderation/auto/check", () => ({
  precheck: (...args: unknown[]) => precheckMock(...args),
  settleAfterWrite: (...args: unknown[]) => settleMock(...args),
  checkMany: vi.fn(async () => {}),
  checkBadgeText: (label: string) => badgeTextMock(label),
}));

// Orders still to ship for the product being deleted: none, unless a spec
// says otherwise. The count itself is a query of its own (lib/orders).
const toShipMock = vi.fn(async (..._args: unknown[]): Promise<number | null> => 0);
vi.mock("@/lib/orders/queries", () => ({
  countToShipForProduct: (...args: unknown[]) => toShipMock(...args),
}));


// Rate limiting is exercised by its own tests; here it defaults to ALLOWED so
// these specs assert the action logic. Each file also has one case that flips
// it to denied, since the limiter fails closed and that path must be covered.
const rateLimitMock = vi.fn();
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  rateLimit: (...args: unknown[]) => rateLimitMock(...args),
}));

// The publish gate reads the owner's profile with the SERVICE ROLE, which has
// no env here. Defaults to "this store may publish" so these specs stay about
// the product write; the cases below flip it to assert the gate itself.
const publishBlockedMock = vi.fn(async () => null as unknown);
vi.mock("@/lib/settings/seller-identity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/settings/seller-identity")>()),
  publishBlockedError: (...args: unknown[]) => publishBlockedMock(...(args as [])),
}));

// ---- imports -------------------------------------------------------------

import { createProduct, updateProduct, deleteProduct } from "@/lib/products/actions";
import { checkBadgeLabel } from "@/lib/products/badge-actions";
import { refusedBadgeLabel } from "@/lib/products/badges";
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
  badgeVerdicts.clear();
  rateLimitMock.mockResolvedValue(true);
  publishBlockedMock.mockResolvedValue(null);
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

describe("createProduct - rate limit", () => {
  it("refuses the write when the budget is spent, before touching the DB or R2", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    rateLimitMock.mockResolvedValue(false);

    const result = await createProduct(validInput());

    expect(result).toMatchObject({ ok: false, error: { code: "rate_limited" } });
    expect(db.insert).not.toHaveBeenCalled();
    expect(headObjectMock).not.toHaveBeenCalled();
  });

  it("checks the budget only after the role gate, so a viewer can't spend it", async () => {
    getActiveAccountMock.mockResolvedValue(viewerAccount());
    await createProduct(validInput());
    expect(rateLimitMock).not.toHaveBeenCalled();
  });
});

describe("createProduct - auth gates", () => {
  it("session expired returns {ok:false} with no supabase call", async () => {
    getActiveAccountMock.mockResolvedValue(null);
    const result = await createProduct(validInput());
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: { code: string } }).error.code).toBe("session_expired");
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("viewer role returns permission error with no DB write and no headObject call", async () => {
    getActiveAccountMock.mockResolvedValue(viewerAccount());
    const result = await createProduct(validInput());
    expect(result.ok).toBe(false);
    expect((result as { error: { code: string } }).error.code).toBe("permission_denied");
    expect(db.insert).not.toHaveBeenCalled();
    expect(headObjectMock).not.toHaveBeenCalled();
  });
});

describe("createProduct - validation", () => {
  it("rejects invalid payload (price = 0) with 'Invalid product data.'", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    const result = await createProduct(validInput({ priceCents: 0 }));
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rejects negative price", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    const result = await createProduct(validInput({ priceCents: -5 }));
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });

  it("imageKey under a different user prefix returns 'Invalid image reference.' with no headObject call", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    const result = await createProduct(validInput({ imageKey: otherOwnerImageKey }));
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
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
    expect(english((result as { error: ActionError }).error.message)).toMatch(/didn't finish/i);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("oversized image (>10 MB) evicted via deleteObject and returns 'too large' error", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    headObjectMock.mockResolvedValue({ size: IMAGE_MAX_BYTES + 1, contentType: "image/png" });
    const result = await createProduct(validInput({ imageKey: ownedImageKey }));
    expect(result.ok).toBe(false);
    expect(english((result as { error: ActionError }).error.message)).toMatch(/too large/i);
    expect(deleteObjectMock).toHaveBeenCalledWith(ownedImageKey);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("wrong contentType evicted and returns 'not supported' error", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    headObjectMock.mockResolvedValue({ size: 1024, contentType: "text/html" });
    const result = await createProduct(validInput({ imageKey: ownedImageKey }));
    expect(result.ok).toBe(false);
    expect(english((result as { error: ActionError }).error.message)).toMatch(/not supported/i);
    expect(deleteObjectMock).toHaveBeenCalledWith(ownedImageKey);
    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe("the automatic content check", () => {
  it("judges a new product before it is written, and settles it after", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    dbFn.mockResolvedValueOnce({
      data: { id: PRODUCT_ID, moderation_status: "pending" },
      error: null,
    });

    await createProduct(validInput({ title: "Checked Product" }));

    // Before: the very object about to be inserted, and no id yet.
    expect(precheckMock).toHaveBeenCalledWith("product", null, db.insert.mock.calls[0][0]);
    expect(precheckMock.mock.invocationCallOrder[0]).toBeLessThan(
      db.insert.mock.invocationCallOrder[0],
    );
    // After: the row the write returned, with the status the wall gave it.
    expect(settleMock).toHaveBeenCalledWith("product", PRODUCT_ID, "pending");
    expect(settleMock.mock.invocationCallOrder[0]).toBeGreaterThan(
      db.insert.mock.invocationCallOrder[0],
    );
  });

  it("does the same for an edit, against the stored row", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    dbFn.mockResolvedValueOnce({ data: { id: PRODUCT_ID, moderation_status: "ok" }, error: null });

    await updateProduct(PRODUCT_ID, validInput({ title: "Edited Product" }));

    expect(precheckMock).toHaveBeenCalledWith("product", PRODUCT_ID, db.update.mock.calls[0][0]);
    expect(precheckMock.mock.invocationCallOrder[0]).toBeLessThan(
      db.update.mock.invocationCallOrder[0],
    );
    expect(settleMock).toHaveBeenCalledWith("product", PRODUCT_ID, "ok");
  });

  it("is not asked about a save that was refused", async () => {
    getActiveAccountMock.mockResolvedValue(viewerAccount());

    await createProduct(validInput());

    expect(precheckMock).not.toHaveBeenCalled();
    expect(settleMock).not.toHaveBeenCalled();
  });

  it("says when the check has not approved the save yet, so the form can tell the seller", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    dbFn.mockResolvedValueOnce({ data: { id: PRODUCT_ID, moderation_status: "pending" }, error: null });
    settleMock.mockResolvedValueOnce("pending");

    expect(await createProduct(validInput())).toEqual({ ok: true, id: PRODUCT_ID, checking: true });

    // A person looking at it is still "not yet"; a pause is the form's own
    // notice, not this one.
    dbFn.mockResolvedValueOnce({ data: { id: PRODUCT_ID, moderation_status: "pending" }, error: null });
    settleMock.mockResolvedValueOnce("review");
    expect(await createProduct(validInput())).toMatchObject({ checking: true });
    dbFn.mockResolvedValueOnce({ data: { id: PRODUCT_ID, moderation_status: "pending" }, error: null });
    settleMock.mockResolvedValueOnce("paused");
    expect(await createProduct(validInput())).toMatchObject({ checking: false });
  });
});

describe("createProduct - happy path", () => {
  it("inserts with owner_id = accountId (not userId) and returns new id", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    dbFn.mockResolvedValueOnce({ data: { id: PRODUCT_ID }, error: null });

    const result = await createProduct(validInput({ imageKey: ownedImageKey }));

    expect(result).toEqual({ ok: true, id: PRODUCT_ID, checking: false });
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
// The publish gate
// ==========================================================================

describe("the publish gate", () => {
  const BLOCKED = traderIdentityRequired(["email"]);

  it("refuses to create an ACTIVE product for a store that may not publish", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    publishBlockedMock.mockResolvedValue(BLOCKED);

    const result = await createProduct(validInput({ status: "active" }));

    expect(result).toEqual({ ok: false, error: BLOCKED });
    // Refused before anything was written or verified.
    expect(db.insert).not.toHaveBeenCalled();
    expect(headObjectMock).not.toHaveBeenCalled();
  });

  it("refuses to update a product TO active for the same store", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    publishBlockedMock.mockResolvedValue(BLOCKED);

    const result = await updateProduct(PRODUCT_ID, validInput({ status: "active" }));

    expect(result).toEqual({ ok: false, error: BLOCKED });
    expect(db.update).not.toHaveBeenCalled();
  });

  it("lets a DRAFT through untouched — the gate is about offering, not authoring", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    publishBlockedMock.mockResolvedValue(BLOCKED);
    dbFn.mockResolvedValueOnce({ data: { id: PRODUCT_ID }, error: null });

    const result = await createProduct(validInput({ status: "draft" }));

    expect(result).toEqual({ ok: true, id: PRODUCT_ID, checking: false });
    // Never even asked: a draft is not a publish.
    expect(publishBlockedMock).not.toHaveBeenCalled();
  });

  it("checks the ACCOUNT that owns the store, not the team member typing", async () => {
    // An editor working on someone else's store: their own details cannot
    // satisfy a gate about the trader the buyer contracts with.
    getActiveAccountMock.mockResolvedValue({
      accountId: OWNER_ID,
      userId: EDITOR_ID,
      role: "editor" as const,
      isOwner: false,
    });
    dbFn.mockResolvedValueOnce({ data: { id: PRODUCT_ID }, error: null });

    await createProduct(validInput({ status: "active" }));

    expect(publishBlockedMock).toHaveBeenCalledWith(OWNER_ID);
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

    expect(result).toEqual({ ok: true, id: PRODUCT_ID, checking: false });
    const updatePayload = db.update.mock.calls[0][0] as Record<string, unknown>;
    expect(updatePayload).not.toHaveProperty("image_key");
  });

  it("imageKey null clears the stored key (sets image_key=null in update)", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    // replacingImage=true: read old keys then update (two maybeSingle calls).
    dbFn.mockResolvedValueOnce({ data: { image_key: oldImageKey, digital_file_key: null }, error: null });
    dbFn.mockResolvedValueOnce({ data: { id: PRODUCT_ID }, error: null });

    const result = await updateProduct(PRODUCT_ID, validInput({ imageKey: null }));

    expect(result).toEqual({ ok: true, id: PRODUCT_ID, checking: false });
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

    expect(result).toEqual({ ok: true, id: PRODUCT_ID, checking: false });
    expect(deleteObjectMock).toHaveBeenCalledWith(oldImageKey);
    expect(deleteObjectMock).not.toHaveBeenCalledWith(ownedImageKey);
  });

  it("0 rows updated returns 'Product not found.' with no eviction", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    // No imageKey: single maybeSingle for the update, returning null (not found).
    dbFn.mockResolvedValueOnce({ data: null, error: null });

    const result = await updateProduct(PRODUCT_ID, validInput());

    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
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
    expect((result as { error: { code: string } }).error.code).toBe("permission_denied");
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
    expect((result as { error: { code: string } }).error.code).toBe("permission_denied");
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("0 rows deleted returns 'Product not found.'", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    dbFn.mockResolvedValueOnce({ data: null, error: null });

    const result = await deleteProduct(PRODUCT_ID);

    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
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

  it("refuses while more orders are still to ship than the seller was warned about", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    toShipMock.mockResolvedValueOnce(2);

    const result = await deleteProduct(PRODUCT_ID, 1);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid_input", message: { key: "Errors.products.ordersToShip", values: { count: 2 } } },
    });
    expect(toShipMock).toHaveBeenCalledWith(OWNER_ID, PRODUCT_ID);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("deletes once the seller has been warned about every order still to ship", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    toShipMock.mockResolvedValueOnce(2);
    dbFn.mockResolvedValueOnce({
      data: { id: PRODUCT_ID, image_key: null, digital_file_key: null },
      error: null,
    });

    const result = await deleteProduct(PRODUCT_ID, 2);

    expect(result).toEqual({ ok: true, id: PRODUCT_ID });
  });

  it("refuses when it cannot tell whether orders are still to ship", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    toShipMock.mockResolvedValueOnce(null);

    const result = await deleteProduct(PRODUCT_ID, 5);

    expect(result).toMatchObject({ ok: false, error: { code: "server_error" } });
    expect(db.delete).not.toHaveBeenCalled();
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

// ==========================================================================
// Badges: judged on their own before the product carrying them is saved
// ==========================================================================

const VIOLATION = { verdict: "violation", ground: "illegal", paths: ["details.badges[].label"] };
const UNSURE = { verdict: "unsure", ground: null, paths: ["details.badges[].label"] };

function withBadges(...labels: string[]) {
  return validInput({ details: { badges: labels.map((label) => ({ icon: "star", label })) } });
}

describe("badges on a save", () => {
  it("refuses a create carrying a badge that breaks the rules, naming it, before anything is written", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    badgeVerdicts.set("Best weed in town", VIOLATION);

    const result = await createProduct(withBadges("Handmade", "Best weed in town"));

    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    const error = (result as { error: ActionError }).error;
    expect(english(error.message)).toBe(
      "The badge “Best weed in town” breaks the platform rules, so it can't be used.",
    );
    expect(english(error.fix!)).toMatch(/support@squareshare\.eu/);
    // The form can tell which badge it was, and put the seller on it.
    expect(refusedBadgeLabel(error)).toBe("Best weed in town");
    expect(precheckMock).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("refuses a badge the check is unsure about, with its own words", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    badgeVerdicts.set("Cures anxiety", UNSURE);

    const result = await createProduct(withBadges("Cures anxiety"));

    expect(english((result as { error: ActionError }).error.message)).toMatch(
      /“Cures anxiety” could not be approved automatically/,
    );
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("leaves a LIVE product untouched when an edit adds a bad badge", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    badgeVerdicts.set("18+ only", VIOLATION);

    const result = await updateProduct(PRODUCT_ID, withBadges("Eco friendly", "18+ only"));

    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(db.update).not.toHaveBeenCalled();
    expect(precheckMock).not.toHaveBeenCalled();
  });

  it("names the FIRST refused badge in the seller's order", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    badgeVerdicts.set("Second bad", VIOLATION);
    badgeVerdicts.set("First bad", UNSURE);

    const result = await updateProduct(PRODUCT_ID, withBadges("Fine", "First bad", "Second bad"));

    expect(english((result as { error: ActionError }).error.message)).toMatch(/“First bad”/);
  });

  it("saves clean badges into the details, judging each one once", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    dbFn.mockResolvedValueOnce({ data: { id: PRODUCT_ID, moderation_status: "ok" }, error: null });

    const result = await updateProduct(PRODUCT_ID, withBadges("Handmade", "Vegan"));

    expect(result).toEqual({ ok: true, id: PRODUCT_ID, checking: false });
    expect(badgeTextMock.mock.calls.map(([label]) => label)).toEqual(["Handmade", "Vegan"]);
    const payload = db.update.mock.calls[0][0] as { details: { badges: unknown[] } };
    expect(payload.details.badges).toEqual([
      { icon: "star", label: "Handmade" },
      { icon: "star", label: "Vegan" },
    ]);
    // The wall still sees them: the precheck gets the same details.
    expect(precheckMock).toHaveBeenCalledWith("product", PRODUCT_ID, payload);
  });

  it("goes on with the save when no answer can be had, and leaves it to the wall", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    badgeVerdicts.set("Handmade", null);
    dbFn.mockResolvedValueOnce({ data: { id: PRODUCT_ID, moderation_status: "pending" }, error: null });
    settleMock.mockResolvedValueOnce("pending");

    const result = await createProduct(withBadges("Handmade"));

    expect(result).toEqual({ ok: true, id: PRODUCT_ID, checking: true });
    expect(db.insert).toHaveBeenCalled();
  });

  it("asks nothing about a product with no badges, or a write that leaves the details alone", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    dbFn.mockResolvedValue({ data: { id: PRODUCT_ID, moderation_status: "ok" }, error: null });

    await createProduct(validInput({ details: { materials: "Oak" } }));
    await updateProduct(PRODUCT_ID, validInput());

    expect(badgeTextMock).not.toHaveBeenCalled();
  });

  it("refuses badges the schema does not allow before asking anyone about them", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());

    const duplicate = await createProduct(withBadges("Vegan", "VEGAN"));
    const tooMany = await createProduct(withBadges("a", "b", "c", "d", "e", "f", "g"));
    const badIcon = await createProduct(
      validInput({ details: { badges: [{ icon: "skull", label: "Spooky" }] } }),
    );
    const badColor = await createProduct(
      validInput({ details: { badges: [{ icon: "star", label: "Neon", color: "#39ff14" }] } }),
    );
    const crowdedPhoto = await createProduct(
      validInput({
        details: {
          badges: ["a", "b", "c", "d"].map((label) => ({ icon: "star", label, placement: "photo-top-left" })),
        },
      }),
    );

    for (const result of [duplicate, tooMany, badIcon, badColor, crowdedPhoto]) {
      expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    }
    expect(badgeTextMock).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("stores a badge's colour and place as given, judging only its words", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    dbFn.mockResolvedValueOnce({ data: { id: PRODUCT_ID, moderation_status: "ok" }, error: null });
    const badges = [
      { icon: "leaf", label: "Eco friendly", color: "green", placement: "photo-top-right" },
      { icon: "truck", label: "Free shipping", color: "blue" },
    ];

    const result = await updateProduct(PRODUCT_ID, validInput({ details: { badges } }));

    expect(result).toMatchObject({ ok: true });
    expect((db.update.mock.calls[0][0] as { details: { badges: unknown } }).details.badges).toEqual(badges);
    expect(badgeTextMock.mock.calls.map(([label]) => label)).toEqual(["Eco friendly", "Free shipping"]);
  });
});

describe("checkBadgeLabel: the check before a written badge is added", () => {
  it("answers ok for clean words, and for words no answer could be had about", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    expect(await checkBadgeLabel("Hand-poured in Lisbon")).toEqual({ ok: true });
    badgeVerdicts.set("Ships fast", null);
    expect(await checkBadgeLabel("Ships fast")).toEqual({ ok: true });
    expect(rateLimitMock).toHaveBeenCalledWith("badge_check", expect.objectContaining({ max: 60 }));
  });

  it("refuses words that break the rules, with the same reason a save would give", async () => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    badgeVerdicts.set("Buy followers here", VIOLATION);

    const result = await checkBadgeLabel("  Buy followers here  ");

    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(english((result as { error: ActionError }).error.message)).toMatch(/“Buy followers here” breaks/);
    expect(badgeTextMock).toHaveBeenCalledWith("Buy followers here");
  });

  it("refuses a signed-out caller, a viewer and a spent budget before judging anything", async () => {
    getActiveAccountMock.mockResolvedValue(null);
    expect(await checkBadgeLabel("Vegan")).toMatchObject({ ok: false, error: { code: "session_expired" } });

    getActiveAccountMock.mockResolvedValue(viewerAccount());
    expect(await checkBadgeLabel("Vegan")).toMatchObject({ ok: false, error: { code: "permission_denied" } });
    expect(rateLimitMock).not.toHaveBeenCalled();

    getActiveAccountMock.mockResolvedValue(ownerAccount());
    rateLimitMock.mockResolvedValue(false);
    expect(await checkBadgeLabel("Vegan")).toMatchObject({ ok: false, error: { code: "rate_limited" } });

    expect(badgeTextMock).not.toHaveBeenCalled();
  });

  it.each([
    ["nothing", ""],
    ["a number", 42],
    ["too many characters", "x".repeat(49)],
    ["a line break", "Eco\nfriendly"],
  ])("refuses %s without asking the classifier", async (_name, label) => {
    getActiveAccountMock.mockResolvedValue(ownerAccount());
    expect(await checkBadgeLabel(label)).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(badgeTextMock).not.toHaveBeenCalled();
  });
});
