/**
 * Stock decrement — the oversell-proof atomic path. Includes a REAL
 * concurrency race across parallel connections: with N units in stock and
 * many simultaneous checkouts, exactly N succeed and stock never goes
 * negative.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asService,
  asSuper,
  asUser,
  closePool,
  createUser,
  expectDbError,
  type TestUser,
} from "../db/client";

let seller: TestUser;

async function makeProduct(opts: {
  track?: boolean;
  qty?: number | null;
  threshold?: number;
  maxPerOrder?: number;
}): Promise<string> {
  const { track = true, qty = 10, threshold = 5, maxPerOrder = 10 } = opts;
  const { rows } = await asService((q) =>
    q.query(
      `insert into public.products (owner_id, title, price_cents, track_stock, stock_quantity, low_stock_threshold, max_per_order)
       values ($1, 'Stocked', 1000, $2, $3, $4, $5) returning id`,
      [seller.id, track, qty, threshold, maxPerOrder],
    ),
  );
  return rows[0].id;
}

async function quantityOf(productId: string): Promise<number | null> {
  const { rows } = await asSuper((q) =>
    q.query(`select stock_quantity from public.products where id = $1`, [productId]),
  );
  return rows[0].stock_quantity;
}

beforeAll(async () => {
  seller = await createUser("stock-seller@test.squareshare.to");
});

afterAll(closePool);

describe("decrement_stock permissions", () => {
  it("authenticated users cannot execute it — even the product owner", async () => {
    const productId = await makeProduct({});
    const msg = await expectDbError(
      asUser(seller, (q) =>
        q.query(`select public.decrement_stock($1, 1)`, [productId]),
      ),
    );
    expect(msg).toMatch(/permission denied/i);
    expect(await quantityOf(productId)).toBe(10);
  });

  it("service_role can execute it", async () => {
    const productId = await makeProduct({});
    const { rows } = await asService((q) =>
      q.query(`select public.decrement_stock($1, 1) as ok`, [productId]),
    );
    expect(rows[0].ok).toBe(true);
    expect(await quantityOf(productId)).toBe(9);
  });
});

describe("decrement_stock semantics", () => {
  it("declines when the requested quantity exceeds stock — stock unchanged", async () => {
    const productId = await makeProduct({ qty: 1 });
    const { rows } = await asService((q) =>
      q.query(`select public.decrement_stock($1, 2) as ok`, [productId]),
    );
    expect(rows[0].ok).toBeNull();
    expect(await quantityOf(productId)).toBe(1);
  });

  it("drains to exactly zero, then declines further decrements", async () => {
    const productId = await makeProduct({ qty: 2 });
    const first = await asService((q) =>
      q.query(`select public.decrement_stock($1, 2) as ok`, [productId]),
    );
    expect(first.rows[0].ok).toBe(true);
    expect(await quantityOf(productId)).toBe(0);

    const second = await asService((q) =>
      q.query(`select public.decrement_stock($1, 1) as ok`, [productId]),
    );
    expect(second.rows[0].ok).toBeNull();
    expect(await quantityOf(productId)).toBe(0);
  });

  it("zero and negative quantities are no-ops", async () => {
    const productId = await makeProduct({ qty: 5 });
    for (const qty of [0, -1, -100]) {
      const { rows } = await asService((q) =>
        q.query(`select public.decrement_stock($1, $2) as ok`, [productId, qty]),
      );
      expect(rows[0].ok, String(qty)).toBeNull();
    }
    expect(await quantityOf(productId)).toBe(5);
  });

  it("untracked products decline (unlimited stock never decrements)", async () => {
    const productId = await makeProduct({ track: false, qty: null });
    const { rows } = await asService((q) =>
      q.query(`select public.decrement_stock($1, 1) as ok`, [productId]),
    );
    expect(rows[0].ok).toBeNull();
  });

  it("unknown product ids decline", async () => {
    const { rows } = await asService((q) =>
      q.query(`select public.decrement_stock('00000000-0000-4000-8000-000000000000', 1) as ok`),
    );
    expect(rows[0].ok).toBeNull();
  });
});

/**
 * THE LAST FENCE. resolveOrderQuantity is the boundary a checkout is supposed
 * to pass, and it refuses an over-limit quantity itself. These tests are about
 * what happens when something DOESN'T pass it: a bug, a hand-run script, a
 * worker holding the service role. The per-order cap has to hold at the
 * database or it only holds where somebody remembered it.
 */
describe("decrement_stock enforces the per-order limit", () => {
  it("declines a quantity above the product's max_per_order, even with stock to spare", async () => {
    const productId = await makeProduct({ qty: 100, maxPerOrder: 3 });
    const { rows } = await asService((q) =>
      q.query(`select public.decrement_stock($1, 4) as ok`, [productId]),
    );
    expect(rows[0].ok).toBeNull();
    expect(await quantityOf(productId)).toBe(100);
  });

  it("allows exactly the limit", async () => {
    const productId = await makeProduct({ qty: 100, maxPerOrder: 3 });
    const { rows } = await asService((q) =>
      q.query(`select public.decrement_stock($1, 3) as ok`, [productId]),
    );
    expect(rows[0].ok).toBe(true);
    expect(await quantityOf(productId)).toBe(97);
  });

  it("cannot be widened by repeating the call — each one is capped on its own", async () => {
    const productId = await makeProduct({ qty: 10, maxPerOrder: 1 });
    for (const qty of [2, 5, 10]) {
      const { rows } = await asService((q) =>
        q.query(`select public.decrement_stock($1, $2) as ok`, [productId, qty]),
      );
      expect(rows[0].ok, String(qty)).toBeNull();
    }
    expect(await quantityOf(productId)).toBe(10);
  });
});

describe("products.max_per_order constraint", () => {
  it("refuses a ceiling outside 1..100, even from the service role", async () => {
    for (const value of [0, -1, 101, 100000]) {
      const message = await expectDbError(
        asService((q) =>
          q.query(
            `insert into public.products (owner_id, title, price_cents, max_per_order)
             values ($1, 'Bad limit', 1000, $2)`,
            [seller.id, value],
          ),
        ),
      );
      expect(message, String(value)).toMatch(/products_max_per_order_range/);
    }
  });

  it("defaults to 10 when a write does not state one", async () => {
    const { rows } = await asService((q) =>
      q.query(
        `insert into public.products (owner_id, title, price_cents)
         values ($1, 'No limit stated', 1000) returning max_per_order`,
        [seller.id],
      ),
    );
    expect(rows[0].max_per_order).toBe(10);
  });
});

describe("decrement_stock RACE — concurrent checkouts", () => {
  it("20 simultaneous single-unit checkouts on 5 units: exactly 5 succeed, floor at 0", async () => {
    const productId = await makeProduct({ qty: 5 });

    const attempts = await Promise.all(
      Array.from({ length: 20 }, () =>
        asService(async (q) => {
          const { rows } = await q.query(
            `select public.decrement_stock($1, 1) as ok`,
            [productId],
          );
          return rows[0].ok === true;
        }),
      ),
    );

    expect(attempts.filter(Boolean)).toHaveLength(5);
    expect(await quantityOf(productId)).toBe(0);
  });

  it("mixed quantities racing on 10 units never oversell", async () => {
    const productId = await makeProduct({ qty: 10 });
    const requested = [4, 4, 4, 3, 3, 3, 2, 2, 1, 1];

    const results = await Promise.all(
      requested.map((qty) =>
        asService(async (q) => {
          const { rows } = await q.query(
            `select public.decrement_stock($1, $2) as ok`,
            [productId, qty],
          );
          return rows[0].ok === true ? qty : 0;
        }),
      ),
    );

    const sold = results.reduce((a, b) => a + b, 0);
    const remaining = await quantityOf(productId);
    expect(remaining).not.toBeNull();
    expect(remaining!).toBeGreaterThanOrEqual(0);
    expect(sold + remaining!).toBe(10); // conservation: nothing overselled or lost
  });

  it("two racing buyers on the LAST unit: exactly one wins", async () => {
    const productId = await makeProduct({ qty: 1 });
    const [a, b] = await Promise.all([
      asService(async (q) => {
        const { rows } = await q.query(`select public.decrement_stock($1, 1) as ok`, [productId]);
        return rows[0].ok === true;
      }),
      asService(async (q) => {
        const { rows } = await q.query(`select public.decrement_stock($1, 1) as ok`, [productId]);
        return rows[0].ok === true;
      }),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await quantityOf(productId)).toBe(0);
  });
});

describe("DB-level stock invariants (defense in depth)", () => {
  it("the CHECK constraint refuses a direct negative write even for service_role", async () => {
    const productId = await makeProduct({ qty: 3 });
    const msg = await expectDbError(
      asService((q) =>
        q.query(`update public.products set stock_quantity = -1 where id = $1`, [productId]),
      ),
    );
    expect(msg).toMatch(/violates check constraint/i);
  });

  it("tracking without a quantity is rejected by the table constraint", async () => {
    const msg = await expectDbError(
      asService((q) =>
        q.query(
          `insert into public.products (owner_id, title, price_cents, track_stock, stock_quantity)
           values ($1, 'bad', 100, true, null)`,
          [seller.id],
        ),
      ),
    );
    expect(msg).toMatch(/products_tracked_stock_has_quantity|violates check/i);
  });
});
