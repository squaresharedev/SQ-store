/**
 * Tests for 20261117_record_signal.sql:
 *   (a) first call with a dedupe key writes the row and returns true
 *   (b) repeat call with the same dedupe key returns false and writes nothing
 *   (c) null dedupe_key always writes (the partial index excludes it)
 *   (d) grant check: service_role can execute, anon and authenticated cannot
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asService,
  asUser,
  closePool,
  createUser,
  type TestUser,
} from "../db/client";

let seller: TestUser;

beforeAll(async () => {
  seller = await createUser("record-signal@test.squareshare.to");
});

afterAll(closePool);

// ---------------------------------------------------------------------------
// (a) first call writes and returns true
// ---------------------------------------------------------------------------
describe("record_signal: first call", () => {
  it("inserts a row and returns true", async () => {
    const dedupeKey = `test-view-${Date.now()}`;
    const { rows } = await asService((q) =>
      q.query(
        `select public.record_signal($1, 'storefront_view', 'embed', null, null, null, null, null, $2) as written`,
        [seller.id, dedupeKey],
      ),
    );
    expect(rows[0].written).toBe(true);

    // Confirm the row is in the table.
    const { rows: check } = await asService((q) =>
      q.query(
        `select count(*)::int as n from public.storefront_signals
         where account_id = $1 and dedupe_key = $2`,
        [seller.id, dedupeKey],
      ),
    );
    expect(check[0].n).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// (b) repeat call with same dedupe key returns false and writes nothing
// ---------------------------------------------------------------------------
describe("record_signal: repeat call", () => {
  it("returns false and does not add a second row", async () => {
    const dedupeKey = `test-dup-${Date.now()}`;

    // First call: written.
    const { rows: first } = await asService((q) =>
      q.query(
        `select public.record_signal($1, 'product_click', 'embed', null, null, null, null, null, $2) as written`,
        [seller.id, dedupeKey],
      ),
    );
    expect(first[0].written).toBe(true);

    // Second call: duplicate.
    const { rows: second } = await asService((q) =>
      q.query(
        `select public.record_signal($1, 'product_click', 'embed', null, null, null, null, null, $2) as written`,
        [seller.id, dedupeKey],
      ),
    );
    expect(second[0].written).toBe(false);

    // Still only one row in the table.
    const { rows: check } = await asService((q) =>
      q.query(
        `select count(*)::int as n from public.storefront_signals
         where account_id = $1 and dedupe_key = $2`,
        [seller.id, dedupeKey],
      ),
    );
    expect(check[0].n).toBe(1);
  });

  it("does not throw on a collision (no error propagated)", async () => {
    const dedupeKey = `test-nothrow-${Date.now()}`;
    await asService((q) =>
      q.query(
        `select public.record_signal($1, 'storefront_view', 'embed', null, null, null, null, null, $2)`,
        [seller.id, dedupeKey],
      ),
    );
    // A second call must succeed without throwing.
    await expect(
      asService((q) =>
        q.query(
          `select public.record_signal($1, 'storefront_view', 'embed', null, null, null, null, null, $2)`,
          [seller.id, dedupeKey],
        ),
      ),
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// (c) null dedupe_key always writes (partial index does not cover it)
// ---------------------------------------------------------------------------
describe("record_signal: null dedupe_key", () => {
  it("always writes and always returns true", async () => {
    // Three calls with null dedupe_key: all three must write.
    for (let i = 0; i < 3; i++) {
      const { rows } = await asService((q) =>
        q.query(
          `select public.record_signal($1, 'storefront_view', 'embed', null, null, null, null, null, null) as written`,
          [seller.id],
        ),
      );
      expect(rows[0].written).toBe(true);
    }

    // All three rows should exist.
    const { rows: check } = await asService((q) =>
      q.query(
        `select count(*)::int as n from public.storefront_signals
         where account_id = $1 and dedupe_key is null
         and kind = 'storefront_view'`,
        [seller.id],
      ),
    );
    expect(check[0].n).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// (d) grant check: only service_role may execute
// ---------------------------------------------------------------------------
describe("record_signal: grants", () => {
  it("anon cannot execute the function", async () => {
    let threw = false;
    try {
      await asAnon((q) =>
        q.query(
          `select public.record_signal($1, 'storefront_view', 'embed', null, null, null, null, null, null)`,
          [seller.id],
        ),
      );
    } catch (err) {
      threw = true;
      expect(String(err)).toMatch(/permission denied/i);
    }
    expect(threw).toBe(true);
  });

  it("authenticated user cannot execute the function", async () => {
    let threw = false;
    try {
      await asUser(seller, (q) =>
        q.query(
          `select public.record_signal($1, 'storefront_view', 'embed', null, null, null, null, null, null)`,
          [seller.id],
        ),
      );
    } catch (err) {
      threw = true;
      expect(String(err)).toMatch(/permission denied/i);
    }
    expect(threw).toBe(true);
  });

  it("service_role can execute the function", async () => {
    const { rows } = await asService((q) =>
      q.query(
        `select public.record_signal($1, 'email_signup', 'embed', null, null, null, null, null, null) as written`,
        [seller.id],
      ),
    );
    expect(rows[0].written).toBe(true);
  });
});
