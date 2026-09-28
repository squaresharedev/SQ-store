// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { orderView } from "../../setup/order-view";

// markOrderShipped: every gate in front of the database function, and the
// rule for when the BUYER is emailed. The database function's own gates are
// proven against the real schema in tests/integration/28-order-fulfilment.

// ---- mocks ---------------------------------------------------------------

const getActiveAccountMock = vi.fn();
const getAccessibleAccountsMock = vi.fn();
vi.mock("@/lib/team/account-context", () => ({
  getActiveAccount: () => getActiveAccountMock(),
  getAccessibleAccounts: () => getAccessibleAccountsMock(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const rateLimitMock = vi.fn();
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  rateLimit: (...args: unknown[]) => rateLimitMock(...args),
}));

const getOrderByIdMock = vi.fn();
vi.mock("@/lib/orders/queries", () => ({
  getOrderById: (...args: unknown[]) => getOrderByIdMock(...args),
}));

const sendShippedEmailMock = vi.fn();
vi.mock("@/lib/orders/emails", () => ({
  sendShippedEmail: (...args: unknown[]) => sendShippedEmailMock(...args),
}));

const getSellerIdentityMock = vi.fn();
vi.mock("@/lib/settings/seller-identity", () => ({
  getSellerIdentity: (...args: unknown[]) => getSellerIdentityMock(...args),
}));

// The request client: the RPC, and the one read of the buyer's language.
const rpcMock = vi.fn();
const localeRead = vi.fn();
const db: Record<string, unknown> = {};
for (const m of ["from", "select", "eq"]) db[m] = vi.fn(() => db);
db.maybeSingle = () => localeRead();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => (db.from as (...a: unknown[]) => unknown)(...args),
  }),
}));

import { markOrderShipped } from "@/lib/orders/actions";

// ---- fixtures ------------------------------------------------------------

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const VIEWER_ID = "20000000-0000-4000-8000-000000000002";
const ORDER_ID = "30000000-0000-4000-8000-000000000003";

const owner = { accountId: OWNER_ID, userId: OWNER_ID, role: "owner" as const, isOwner: true };
const viewer = { accountId: OWNER_ID, userId: VIEWER_ID, role: "viewer" as const, isOwner: false };

const waiting = orderView({
  id: ORDER_ID,
  fulfilment: { status: "unfulfilled", shippedAt: null, trackingNumber: null },
});
const shipped = (trackingNumber: string | null) =>
  orderView({
    id: ORDER_ID,
    fulfilment: { status: "shipped", shippedAt: "2026-09-27T10:00:00Z", trackingNumber },
  });

beforeEach(() => {
  vi.clearAllMocks();
  getActiveAccountMock.mockResolvedValue(owner);
  getAccessibleAccountsMock.mockResolvedValue([
    { accountId: OWNER_ID, role: "owner", storeName: "harbourpottery", isSelf: true },
  ]);
  rateLimitMock.mockResolvedValue(true);
  getOrderByIdMock.mockResolvedValue(waiting);
  rpcMock.mockResolvedValue({ data: "shipped", error: null });
  localeRead.mockResolvedValue({ data: { buyer_locale: "de" }, error: null });
  getSellerIdentityMock.mockResolvedValue({ businessName: "Harbour Pottery", email: "hello@harbour.example" });
  sendShippedEmailMock.mockResolvedValue({ sent: true });
});

// ---- gates ---------------------------------------------------------------

describe("markOrderShipped - gates", () => {
  it("needs a session", async () => {
    getActiveAccountMock.mockResolvedValue(null);
    expect(await markOrderShipped(ORDER_ID, "")).toMatchObject({ error: { code: "session_expired" } });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("refuses a viewer before touching anything", async () => {
    getActiveAccountMock.mockResolvedValue(viewer);
    expect(await markOrderShipped(ORDER_ID, "")).toMatchObject({ error: { code: "permission_denied" } });
    expect(rateLimitMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("stops when the budget is spent", async () => {
    rateLimitMock.mockResolvedValue(false);
    expect(await markOrderShipped(ORDER_ID, "")).toMatchObject({ error: { code: "rate_limited" } });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("reads a malformed id as a missing order", async () => {
    expect(await markOrderShipped("1; drop table orders", "")).toMatchObject({ error: { code: "not_found" } });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("refuses a tracking number that is not one, with the field's own message", async () => {
    const result = await markOrderShipped(ORDER_ID, "<script>alert(1)</script>");
    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid_input", message: { key: "Validation.referenceCode.trackingNumber" } },
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("only ships an order in the store being worked on", async () => {
    getOrderByIdMock.mockResolvedValue(null);
    expect(await markOrderShipped(ORDER_ID, "")).toMatchObject({ error: { code: "not_found" } });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

// ---- outcomes ------------------------------------------------------------

describe("markOrderShipped - outcomes", () => {
  it("ships it, with the trimmed number, and emails the buyer in their language", async () => {
    getOrderByIdMock.mockResolvedValueOnce(waiting).mockResolvedValueOnce(shipped("RR123456789IE"));
    const result = await markOrderShipped(ORDER_ID, "  RR123456789IE ");

    expect(rpcMock).toHaveBeenCalledWith("order_mark_shipped", {
      p_order_id: ORDER_ID,
      p_tracking_number: "RR123456789IE",
    });
    expect(result).toMatchObject({ ok: true, buyerEmailed: true });
    const [to, locale, mail] = sendShippedEmailMock.mock.calls[0]!;
    expect(to).toBe("buyer@example.com");
    expect(locale).toBe("de");
    expect(mail).toMatchObject({
      kind: "shipped",
      trackingNumber: "RR123456789IE",
      store: { name: "Harbour Pottery", contactEmail: "hello@harbour.example" },
    });
  });

  it("sends no tracking number when none was typed", async () => {
    await markOrderShipped(ORDER_ID, "   ");
    expect(rpcMock.mock.calls[0]![1]).toEqual({ p_order_id: ORDER_ID, p_tracking_number: null });
  });

  it("tells the buyer about a tracking number added later", async () => {
    rpcMock.mockResolvedValue({ data: "tracking_updated", error: null });
    getOrderByIdMock.mockResolvedValue(shipped("RR000000001IE"));
    const result = await markOrderShipped(ORDER_ID, "RR000000001IE");
    expect(result).toMatchObject({ ok: true, buyerEmailed: true });
    expect(sendShippedEmailMock.mock.calls[0]![2]).toMatchObject({ kind: "tracking" });
  });

  it("says nothing to the buyer when a number is cleared or re-saved as it was", async () => {
    rpcMock.mockResolvedValue({ data: "tracking_updated", error: null });
    getOrderByIdMock.mockResolvedValue(shipped(null));
    expect(await markOrderShipped(ORDER_ID, "")).toMatchObject({ ok: true, buyerEmailed: false });

    rpcMock.mockResolvedValue({ data: "unchanged", error: null });
    getOrderByIdMock.mockResolvedValue(shipped("RR000000001IE"));
    expect(await markOrderShipped(ORDER_ID, "RR000000001IE")).toMatchObject({ ok: true, buyerEmailed: false });

    expect(sendShippedEmailMock).not.toHaveBeenCalled();
  });

  it("reports honestly when the email did not go, or there was nobody to send it to", async () => {
    sendShippedEmailMock.mockResolvedValue({ sent: false, reason: "disabled" });
    expect(await markOrderShipped(ORDER_ID, "")).toMatchObject({ ok: true, buyerEmailed: false });

    sendShippedEmailMock.mockClear();
    getOrderByIdMock.mockResolvedValue(orderView({ id: ORDER_ID, buyerEmail: null }));
    expect(await markOrderShipped(ORDER_ID, "")).toMatchObject({ ok: true, buyerEmailed: false });
    expect(sendShippedEmailMock).not.toHaveBeenCalled();
  });

  it("names the store by its handle when no trading name is set", async () => {
    getSellerIdentityMock.mockResolvedValue({});
    await markOrderShipped(ORDER_ID, "");
    expect(sendShippedEmailMock.mock.calls[0]![2]).toMatchObject({
      store: { name: "harbourpottery", contactEmail: null },
    });
  });

  it("falls back to English for a buyer whose language is unknown", async () => {
    localeRead.mockResolvedValue({ data: { buyer_locale: null }, error: null });
    await markOrderShipped(ORDER_ID, "");
    expect(sendShippedEmailMock.mock.calls[0]![1]).toBe("en");
  });

  it("turns the database's refusals into the seller's words", async () => {
    rpcMock.mockResolvedValue({ data: "not_shippable", error: null });
    expect(await markOrderShipped(ORDER_ID, "")).toMatchObject({
      error: { code: "invalid_input", message: { key: "Errors.orders.notShippable.message" } },
    });
    rpcMock.mockResolvedValue({ data: "not_found", error: null });
    expect(await markOrderShipped(ORDER_ID, "")).toMatchObject({ error: { code: "not_found" } });
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await markOrderShipped(ORDER_ID, "")).toMatchObject({ error: { code: "server_error" } });
    expect(sendShippedEmailMock).not.toHaveBeenCalled();
  });
});
