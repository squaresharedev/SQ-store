// @vitest-environment node
/**
 * Unit tests for src/lib/analytics/record.ts:
 *   (a) RPC path mapping: true -> "written", false -> "duplicate", error -> "failed"
 *   (b) Fallback when RPC is absent (PGRST202): plain insert, same mapping
 *   (c) Non-PGRST202 errors from the RPC return "failed" immediately
 *   (d) Exceptions from either path return "failed" and do not propagate
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Stub the admin client before importing the module under test.
const rpcMock = vi.fn();
const insertMock = vi.fn();
const fromChain = {
  insert: (...args: unknown[]) => insertMock(...args),
};
const adminMock = {
  rpc: (...args: unknown[]) => rpcMock(...args),
  from: (_table: string) => fromChain,
};
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => adminMock,
}));

const { recordSignal } = await import("@/lib/analytics/record");

const BASE: Parameters<typeof recordSignal>[0] = {
  accountId: "11111111-1111-4111-8111-111111111111",
  kind: "storefront_view",
  storefrontId: "22222222-2222-4222-8222-222222222222",
  channel: "embed",
  dedupeKey: "dk-abc123",
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// (a) RPC path: success cases
// ---------------------------------------------------------------------------
describe("recordSignal via RPC", () => {
  it('returns "written" when RPC returns true', async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    expect(await recordSignal(BASE)).toBe("written");
    expect(rpcMock).toHaveBeenCalledOnce();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('returns "duplicate" when RPC returns false', async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });
    expect(await recordSignal(BASE)).toBe("duplicate");
    expect(rpcMock).toHaveBeenCalledOnce();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("passes all fields to the RPC with p_ prefix", async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    await recordSignal({
      ...BASE,
      blockId: "blk1",
      visitorHash: "vh",
      valueCents: 100,
      currency: "EUR",
      metadata: { src: "unit" },
    });
    const args = rpcMock.mock.calls[0];
    expect(args[0]).toBe("record_signal");
    const params = args[1];
    expect(params.p_account_id).toBe(BASE.accountId);
    expect(params.p_kind).toBe("storefront_view");
    expect(params.p_channel).toBe("embed");
    expect(params.p_storefront_id).toBe(BASE.storefrontId);
    expect(params.p_block_id).toBe("blk1");
    expect(params.p_visitor_hash).toBe("vh");
    expect(params.p_value_cents).toBe(100);
    expect(params.p_currency).toBe("EUR");
    expect(params.p_dedupe_key).toBe("dk-abc123");
    expect(params.p_metadata).toEqual({ src: "unit" });
  });

  it("defaults channel to embed when not provided", async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    const { channel: _, ...noChannel } = BASE;
    await recordSignal(noChannel);
    expect(rpcMock.mock.calls[0][1].p_channel).toBe("embed");
  });
});

// ---------------------------------------------------------------------------
// (b) Fallback path: RPC absent (PGRST202) -> plain insert
// ---------------------------------------------------------------------------
describe("recordSignal fallback when RPC is not found", () => {
  const pgrst202 = { data: null, error: { code: "PGRST202", message: "function not found" } };

  it('falls back to insert and returns "written" on success', async () => {
    rpcMock.mockResolvedValue(pgrst202);
    insertMock.mockResolvedValue({ error: null });
    expect(await recordSignal(BASE)).toBe("written");
    expect(insertMock).toHaveBeenCalledOnce();
  });

  it('falls back to insert and returns "duplicate" on 23505', async () => {
    rpcMock.mockResolvedValue(pgrst202);
    insertMock.mockResolvedValue({ error: { code: "23505", message: "unique violation" } });
    expect(await recordSignal(BASE)).toBe("duplicate");
  });

  it('falls back and returns "failed" on other insert errors', async () => {
    rpcMock.mockResolvedValue(pgrst202);
    insertMock.mockResolvedValue({ error: { code: "42000", message: "syntax error" } });
    expect(await recordSignal(BASE)).toBe("failed");
  });

  it("passes the same field values in the fallback insert", async () => {
    rpcMock.mockResolvedValue(pgrst202);
    insertMock.mockResolvedValue({ error: null });
    await recordSignal(BASE);
    const inserted = insertMock.mock.calls[0][0];
    expect(inserted.account_id).toBe(BASE.accountId);
    expect(inserted.kind).toBe("storefront_view");
    expect(inserted.dedupe_key).toBe("dk-abc123");
    expect(inserted.channel).toBe("embed");
  });
});

// ---------------------------------------------------------------------------
// (c) Non-PGRST202 RPC errors return "failed" without touching insert
// ---------------------------------------------------------------------------
describe("recordSignal RPC non-PGRST202 error", () => {
  it('returns "failed" on a server 500 error from the RPC', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "500", message: "internal error" } });
    expect(await recordSignal(BASE)).toBe("failed");
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('returns "failed" on a permissions error from the RPC', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied" } });
    expect(await recordSignal(BASE)).toBe("failed");
    expect(insertMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (d) Thrown exceptions never propagate
// ---------------------------------------------------------------------------
describe("recordSignal exception safety", () => {
  it('returns "failed" when rpc throws instead of propagating', async () => {
    rpcMock.mockRejectedValue(new Error("network timeout"));
    expect(await recordSignal(BASE)).toBe("failed");
  });

  it('returns "failed" when the fallback insert throws', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "not found" } });
    insertMock.mockRejectedValue(new Error("connection reset"));
    expect(await recordSignal(BASE)).toBe("failed");
  });

  it("never throws regardless of the error path", async () => {
    rpcMock.mockRejectedValue(new TypeError("boom"));
    await expect(recordSignal(BASE)).resolves.toBe("failed");
  });
});
