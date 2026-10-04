// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscountView } from "@/types/discount";

// The seller's discount writes: every gate in front of the database, what is
// written (and to which store), and how the database's refusals come back in
// the seller's words. The database's own rules (RLS, the guard trigger) are
// proven against the real schema in tests/integration/32-discounts.

// ---- mocks ---------------------------------------------------------------

const getActiveAccountMock = vi.fn();
vi.mock("@/lib/team/account-context", () => ({
  getActiveAccount: () => getActiveAccountMock(),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

const rateLimitMock = vi.fn();
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  rateLimit: (...args: unknown[]) => rateLimitMock(...args),
}));

const getDiscountMock = vi.fn();
vi.mock("@/lib/discounts/queries", () => ({
  getDiscount: (...args: unknown[]) => getDiscountMock(...args),
}));

/** Every call the actions make on the request client, and what it answers. */
const db = {
  calls: [] as { table: string; op: string; args: unknown[] }[],
  productsCount: 1 as number | null,
  liveCount: 0,
  insert: { data: { id: "new-id" } as { id: string } | null, error: null as { code: string; message: string } | null },
  update: { data: { id: "existing" } as { id: string } | null, error: null as { code: string; message: string } | null },
};

function chain(table: string) {
  const link: Record<string, unknown> = {};
  const record = (op: string) => (...args: unknown[]) => {
    db.calls.push({ table, op, args });
    return link;
  };
  for (const op of ["select", "eq", "is", "in", "insert", "update"]) link[op] = record(op);
  link.single = async () => db.insert;
  link.maybeSingle = async () => db.update;
  // A head count is awaited on the chain itself.
  link.then = (resolve: (value: unknown) => void) =>
    resolve({ count: table === "products" ? db.productsCount : db.liveCount, error: null });
  return link;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (table: string) => chain(table) }),
}));

const { createDiscount, deleteDiscount, endSale, setCodeEnabled, updateDiscount } = await import(
  "@/lib/discounts/actions"
);

// ---- fixtures ------------------------------------------------------------

const STORE = "10000000-0000-4000-8000-000000000001";
const VIEWER = "20000000-0000-4000-8000-000000000002";
const DISCOUNT = "30000000-0000-4000-8000-000000000003";
const PRODUCT = "40000000-0000-4000-8000-000000000004";

const owner = { accountId: STORE, userId: STORE, role: "owner" as const, isOwner: true };
const viewer = { accountId: STORE, userId: VIEWER, role: "viewer" as const, isOwner: false };

const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
const inADay = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

const codeInput = {
  kind: "code",
  value: { type: "percent", percentOff: 10 },
  appliesTo: "all",
  productIds: [],
  startsAt: null,
  endsAt: null,
  code: "summer10",
  shareChannel: "Instagram",
  usageLimit: 100,
  enabled: true,
};

const saleInput = {
  kind: "automatic",
  value: { type: "percent", percentOff: 20 },
  appliesTo: "products",
  productIds: [PRODUCT],
  startsAt: null,
  endsAt: null,
};

function startedSale(overrides: Partial<DiscountView> = {}): DiscountView {
  return {
    id: DISCOUNT,
    kind: "automatic",
    code: null,
    shareChannel: null,
    value: { type: "percent", percentOff: 20 },
    appliesTo: "products",
    productIds: [PRODUCT],
    startsAt: "2026-01-01T00:00:00.000Z",
    endsAt: null,
    usageLimit: null,
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const writes = (op: "insert" | "update") => db.calls.filter((call) => call.table === "discounts" && call.op === op);
const filtersOf = (table: string) =>
  db.calls.filter((call) => call.table === table && ["eq", "is", "in"].includes(call.op)).map((call) => [call.op, ...call.args]);

beforeEach(() => {
  vi.clearAllMocks();
  db.calls = [];
  db.productsCount = 1;
  db.liveCount = 0;
  db.insert = { data: { id: "new-id" }, error: null };
  db.update = { data: { id: DISCOUNT }, error: null };
  getActiveAccountMock.mockResolvedValue(owner);
  rateLimitMock.mockResolvedValue(true);
  getDiscountMock.mockResolvedValue(startedSale());
});

// ---- gates ---------------------------------------------------------------

describe("discount writes: the gate", () => {
  it("needs a session", async () => {
    getActiveAccountMock.mockResolvedValue(null);
    expect(await createDiscount(codeInput)).toMatchObject({ error: { code: "session_expired" } });
    expect(db.calls).toEqual([]);
  });

  it("refuses a viewer before spending the budget or touching anything", async () => {
    getActiveAccountMock.mockResolvedValue(viewer);
    for (const run of [
      () => createDiscount(codeInput),
      () => updateDiscount(DISCOUNT, codeInput),
      () => setCodeEnabled(DISCOUNT, false),
      () => endSale(DISCOUNT),
      () => deleteDiscount(DISCOUNT),
    ]) {
      expect(await run()).toMatchObject({
        error: { code: "permission_denied", message: { key: "Errors.permissionDenied.manageDiscounts.withRole" } },
      });
    }
    expect(rateLimitMock).not.toHaveBeenCalled();
    expect(db.calls).toEqual([]);
  });

  it("stops when the budget is spent", async () => {
    rateLimitMock.mockResolvedValue(false);
    expect(await createDiscount(codeInput)).toMatchObject({ error: { code: "rate_limited" } });
    expect(rateLimitMock).toHaveBeenCalledWith("discount_write", expect.objectContaining({ max: 120 }));
    expect(db.calls).toEqual([]);
  });

  it("refuses input that does not parse, with the field's own message", async () => {
    expect(await createDiscount({ ...codeInput, value: { type: "percent", percentOff: 95 } })).toMatchObject({
      error: { code: "invalid_input", message: { key: "Validation.int.percentOff.tooBig" } },
    });
    expect(await createDiscount({ ...codeInput, ownerId: VIEWER })).toMatchObject({ error: { code: "invalid_input" } });
    expect(db.calls).toEqual([]);
  });

  it("reads a malformed id as a missing discount", async () => {
    for (const run of [
      () => updateDiscount("1; drop", codeInput),
      () => setCodeEnabled("nope", true),
      () => endSale("nope"),
      () => deleteDiscount("nope"),
    ]) {
      expect(await run()).toMatchObject({ error: { code: "not_found" } });
    }
  });
});

// ---- create --------------------------------------------------------------

describe("createDiscount", () => {
  it("writes the code to the ACTIVE store, normalised, and refreshes the list", async () => {
    expect(await createDiscount(codeInput)).toEqual({ ok: true, id: "new-id" });
    const [insert] = writes("insert");
    expect(insert!.args[0]).toMatchObject({
      owner_id: STORE,
      kind: "code",
      code: "SUMMER10",
      share_channel: "Instagram",
      value_type: "percent",
      percent_off: 10,
      amount_off_cents: null,
      currency: null,
      applies_to: "all",
      product_ids: [],
      ends_at: null,
      usage_limit: 100,
      enabled: true,
    });
    // "Now" is the server's now, not the browser's.
    expect(Date.now() - Date.parse(String((insert!.args[0] as { starts_at: string }).starts_at))).toBeLessThan(5000);
    expect(revalidatePath).toHaveBeenCalledWith("/discounts");
  });

  it("clears what a sale cannot have, and keeps it switched on", async () => {
    await createDiscount(saleInput);
    expect(writes("insert")[0]!.args[0]).toMatchObject({
      kind: "automatic",
      code: null,
      share_channel: null,
      usage_limit: null,
      enabled: true,
      product_ids: [PRODUCT],
    });
  });

  it("only accepts this store's products", async () => {
    db.productsCount = 0;
    expect(await createDiscount(saleInput)).toMatchObject({
      error: { code: "invalid_input", message: { key: "Validation.uuid.product" } },
    });
    expect(filtersOf("products")).toEqual(
      expect.arrayContaining([
        ["eq", "owner_id", STORE],
        ["in", "id", [PRODUCT]],
      ]),
    );
    expect(writes("insert")).toEqual([]);
  });

  it("refuses a start or an end in the past", async () => {
    expect(await createDiscount({ ...saleInput, startsAt: "2020-01-01T00:00:00.000Z" })).toMatchObject({
      error: { message: { key: "Validation.discount.startInPast" } },
    });
    expect(
      await createDiscount({ ...codeInput, startsAt: "2019-12-01T00:00:00.000Z", endsAt: "2020-01-01T00:00:00.000Z" }),
    ).toMatchObject({ error: { code: "invalid_input" } });
    expect(writes("insert")).toEqual([]);
  });

  it("stops at the most discounts a store can have", async () => {
    db.liveCount = 100;
    expect(await createDiscount(codeInput)).toMatchObject({
      error: { code: "invalid_input", message: { key: "Errors.discounts.tooMany.message" } },
    });
    expect(writes("insert")).toEqual([]);
  });

  it("says a code is taken when the store already has it", async () => {
    db.insert = { data: null, error: { code: "23505", message: "duplicate key" } };
    expect(await createDiscount(codeInput)).toMatchObject({
      error: { message: { key: "Errors.discounts.codeTaken.message" } },
    });
  });
});

// ---- update --------------------------------------------------------------

describe("updateDiscount", () => {
  it("lets a started sale move its end, and changes nothing else", async () => {
    const endsAt = inADay();
    const result = await updateDiscount(DISCOUNT, {
      ...saleInput,
      startsAt: "2026-01-01T00:00:00.000Z",
      endsAt,
    });
    expect(result).toEqual({ ok: true, id: DISCOUNT });
    expect(writes("update")[0]!.args[0]).toEqual({ ends_at: endsAt });
    expect(filtersOf("discounts")).toEqual(
      expect.arrayContaining([
        ["eq", "id", DISCOUNT],
        ["eq", "owner_id", STORE],
        ["is", "archived_at", null],
      ]),
    );
  });

  it("refuses to change a started sale's terms", async () => {
    expect(
      await updateDiscount(DISCOUNT, {
        ...saleInput,
        value: { type: "percent", percentOff: 40 },
        startsAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toMatchObject({ error: { message: { key: "Errors.discounts.started.message" } } });
    expect(
      await updateDiscount(DISCOUNT, { ...saleInput, productIds: [], appliesTo: "all", startsAt: "2026-01-01T00:00:00.000Z" }),
    ).toMatchObject({ error: { message: { key: "Errors.discounts.started.message" } } });
    expect(writes("update")).toEqual([]);
  });

  it("knows the stored start however it is spelled: the database's way, or a browser's", async () => {
    // PostgREST prints "+00:00" and microseconds; a browser prints "Z" and
    // milliseconds. The same moment must never read as a changed start.
    getDiscountMock.mockResolvedValue(startedSale({ startsAt: "2026-01-01T00:00:00.123456+00:00" }));
    const endsAt = inADay();
    for (const startsAt of ["2026-01-01T00:00:00.123456+00:00", "2026-01-01T00:00:00.123Z"]) {
      db.calls = [];
      expect(await updateDiscount(DISCOUNT, { ...saleInput, startsAt, endsAt }), startsAt).toEqual({
        ok: true,
        id: DISCOUNT,
      });
      expect(writes("update")[0]!.args[0]).toEqual({ ends_at: endsAt });
    }
  });

  it("lets a running code change its terms with its start left where it was", async () => {
    const startsAt = "2026-01-01T00:00:00.123456+00:00";
    getDiscountMock.mockResolvedValue(startedSale({ kind: "code", code: "SUMMER10", startsAt }));
    expect(
      await updateDiscount(DISCOUNT, { ...codeInput, value: { type: "percent", percentOff: 15 }, startsAt }),
    ).toEqual({ ok: true, id: DISCOUNT });
    expect(writes("update")[0]!.args[0]).toMatchObject({ percent_off: 15, starts_at: startsAt, code: "SUMMER10" });
  });

  it("refuses a start moved back to another past moment", async () => {
    getDiscountMock.mockResolvedValue(startedSale({ kind: "code", code: "SUMMER10" }));
    expect(await updateDiscount(DISCOUNT, { ...codeInput, startsAt: "2025-06-01T00:00:00.000Z" })).toMatchObject({
      error: { message: { key: "Validation.discount.startInPast" } },
    });
    expect(writes("update")).toEqual([]);
  });

  it("lets a scheduled sale change anything", async () => {
    getDiscountMock.mockResolvedValue(startedSale({ startsAt: inADay() }));
    const startsAt = inAnHour();
    await updateDiscount(DISCOUNT, { ...saleInput, value: { type: "percent", percentOff: 30 }, startsAt });
    expect(writes("update")[0]!.args[0]).toMatchObject({ percent_off: 30, starts_at: startsAt });
  });

  it("never turns a code into a sale", async () => {
    getDiscountMock.mockResolvedValue(startedSale({ kind: "code", code: "SUMMER10" }));
    expect(await updateDiscount(DISCOUNT, saleInput)).toMatchObject({
      error: { message: { key: "Errors.discounts.invalid.message" } },
    });
  });

  it("is not found outside the active store", async () => {
    getDiscountMock.mockResolvedValue(null);
    expect(await updateDiscount(DISCOUNT, codeInput)).toMatchObject({ error: { code: "not_found" } });
  });

  it("passes on the database guard's refusal in the seller's words", async () => {
    getDiscountMock.mockResolvedValue(startedSale({ startsAt: inADay() }));
    db.update = { data: null, error: { code: "42501", message: "discount_started" } };
    expect(await updateDiscount(DISCOUNT, { ...saleInput, startsAt: inAnHour() })).toMatchObject({
      error: { message: { key: "Errors.discounts.started.message" } },
    });
  });
});

// ---- the small writes -------------------------------------------------------

describe("switch, end and delete", () => {
  it("switches only a code of the active store", async () => {
    expect(await setCodeEnabled(DISCOUNT, false)).toEqual({ ok: true, id: DISCOUNT });
    expect(writes("update")[0]!.args[0]).toEqual({ enabled: false });
    expect(filtersOf("discounts")).toEqual(
      expect.arrayContaining([
        ["eq", "owner_id", STORE],
        ["eq", "kind", "code"],
      ]),
    );
  });

  it("ends only a sale, now", async () => {
    await endSale(DISCOUNT);
    const { ends_at } = writes("update")[0]!.args[0] as { ends_at: string };
    expect(Math.abs(Date.now() - Date.parse(ends_at))).toBeLessThan(5000);
    expect(filtersOf("discounts")).toEqual(expect.arrayContaining([["eq", "kind", "automatic"]]));
  });

  it("deletes by archiving, never by removing the row", async () => {
    await deleteDiscount(DISCOUNT);
    expect(Object.keys(writes("update")[0]!.args[0] as object)).toEqual(["archived_at"]);
    expect(db.calls.some((call) => call.op === "delete")).toBe(false);
  });

  it("is not found when nothing matched", async () => {
    db.update = { data: null, error: null };
    expect(await deleteDiscount(DISCOUNT)).toMatchObject({ error: { code: "not_found" } });
  });
});
