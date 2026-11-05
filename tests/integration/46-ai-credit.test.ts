/**
 * AI credit (20261104_ai_credit), against the replayed schema.
 *
 * What keeps AI writing help from costing more than it earns, held by the
 * database: before a call, the most it can cost is held on the store's month
 * and the platform's day in one locked step that refuses when either has no
 * room; after it, the hold is settled to what it cost. Calls fired together
 * can never hold past the allowance, and only the server can hold, settle or
 * read. A client that could would reset its own month and spend on, or
 * charge someone else's.
 */
import { afterAll, describe, expect, it } from "vitest";
import { asAnon, asService, asSuper, asUser, closePool, createUser, expectDbError } from "../db/client";

afterAll(closePool);

const MONTH = "2026-11-01";
/** Each test its own day, so the platform's row is its own too. */
let dayCount = 0;
const freshDay = () => `2031-01-${String(++dayCount).padStart(2, "0")}`;
/** Far past anything a test holds: the platform's ceiling out of the way. */
const NO_CEILING = 1_000_000_000;

const hold = (owner: string, micros: number, allowance: number, day: string, platformMax = NO_CEILING, period = MONTH) =>
  asService((q) =>
    q.query<{ ai_credit_hold: string }>("select public.ai_credit_hold($1, $2, $3, $4, $5, $6)", [
      owner,
      period,
      day,
      micros,
      allowance,
      platformMax,
    ]),
  ).then((result) => result.rows[0]!.ai_credit_hold);

const settle = (owner: string, delta: number, day: string, period = MONTH) =>
  asService((q) => q.query("select public.ai_credit_settle($1, $2, $3, $4)", [owner, period, day, delta]));

const store = (owner: string, period = MONTH) =>
  asSuper((q) =>
    q.query("select used_micros, calls from public.ai_credit_usage where owner_id = $1 and period = $2", [owner, period]),
  ).then((result) => result.rows[0]);

const platform = (day: string) =>
  asSuper((q) => q.query("select used_micros, calls from public.ai_platform_usage where day = $1", [day])).then(
    (result) => result.rows[0],
  );

describe("ai_credit_hold and ai_credit_settle", () => {
  it("hold the most a call can cost, then settle it to what it really cost", async () => {
    const owner = await createUser();
    const day = freshDay();
    expect(await hold(owner.id, 3_000, 10_000, day)).toBe("held");
    expect(await store(owner.id)).toEqual({ used_micros: "3000", calls: 1 });
    expect(await platform(day)).toEqual({ used_micros: "3000", calls: 1 });
    // The call cost 192: what was held and not spent goes back, on both rows.
    await settle(owner.id, 192 - 3_000, day);
    expect(await store(owner.id)).toEqual({ used_micros: "192", calls: 1 });
    expect(await platform(day)).toEqual({ used_micros: "192", calls: 1 });
    // A call past its hold is charged all the same; nothing goes below zero.
    await settle(owner.id, 50, day);
    expect(await store(owner.id)).toEqual({ used_micros: "242", calls: 1 });
    await settle(owner.id, -1_000_000, day);
    expect(await store(owner.id)).toEqual({ used_micros: "0", calls: 1 });
  });

  it("refuses a hold the month has no room for, and holds nothing for it", async () => {
    const owner = await createUser();
    const day = freshDay();
    expect(await hold(owner.id, 6_000, 10_000, day)).toBe("held");
    expect(await hold(owner.id, 5_000, 10_000, day)).toBe("credit_used");
    expect(await hold(owner.id, 4_000, 10_000, day)).toBe("held");
    expect(await hold(owner.id, 1, 10_000, day)).toBe("credit_used");
    expect(await store(owner.id)).toEqual({ used_micros: "10000", calls: 2 });
    // A plan without credit holds nothing at all.
    const free = await createUser();
    expect(await hold(free.id, 1, 0, day)).toBe("credit_used");
  });

  it("never holds past the allowance, however many calls arrive together", async () => {
    const owner = await createUser();
    const day = freshDay();
    const answers = await Promise.all(Array.from({ length: 25 }, () => hold(owner.id, 1_000, 10_000, day)));
    expect(answers.filter((answer) => answer === "held")).toHaveLength(10);
    expect(answers.filter((answer) => answer === "credit_used")).toHaveLength(15);
    expect(await store(owner.id)).toEqual({ used_micros: "10000", calls: 10 });
  });

  it("caps the platform's day across every store, whatever each has left", async () => {
    const [first, second] = [await createUser(), await createUser()];
    const day = freshDay();
    expect(await hold(first.id, 700, 10_000, day, 1_000)).toBe("held");
    expect(await hold(second.id, 400, 10_000, day, 1_000)).toBe("platform_full");
    // A refused hold takes nothing from the store either.
    expect(await store(second.id)).toEqual({ used_micros: "0", calls: 0 });
    expect(await hold(second.id, 300, 10_000, day, 1_000)).toBe("held");
    expect(await platform(day)).toEqual({ used_micros: "1000", calls: 2 });
    // The next day starts empty.
    expect(await hold(second.id, 400, 10_000, freshDay(), 1_000)).toBe("held");
  });

  it("keeps each month apart, and only the first of a month is a month", async () => {
    const owner = await createUser();
    const day = freshDay();
    expect(await hold(owner.id, 10_000, 10_000, day, NO_CEILING, "2026-10-01")).toBe("held");
    expect(await hold(owner.id, 10_000, 10_000, day, NO_CEILING, "2026-11-01")).toBe("held");
    expect(await expectDbError(hold(owner.id, 1, 10_000, day, NO_CEILING, "2026-11-04"))).toContain(
      "ai_credit_usage_period_check",
    );
  });

  it("refuses a hold with no amount, no allowance or no ceiling, rather than holding nothing", async () => {
    const owner = await createUser();
    const day = freshDay();
    for (const run of [
      () => hold(owner.id, -5, 10_000, day),
      () =>
        asService((q) => q.query("select public.ai_credit_hold($1, $2, $3, null, 10000, 10000)", [owner.id, MONTH, day])),
      () => asService((q) => q.query("select public.ai_credit_hold($1, $2, $3, 5, null, 10000)", [owner.id, MONTH, day])),
      () => asService((q) => q.query("select public.ai_credit_hold($1, $2, $3, 5, 10000, null)", [owner.id, MONTH, day])),
    ]) {
      expect(await expectDbError(run)).toContain("a hold needs");
    }
  });

  it("is the server's alone: no client can hold, settle, read or reset", async () => {
    const owner = await createUser();
    const day = freshDay();
    await hold(owner.id, 500, 10_000, day);
    for (const run of [
      () =>
        asUser(owner, (q) =>
          q.query("select public.ai_credit_hold($1, $2, $3, 0, 1000000000, 1000000000)", [owner.id, MONTH, day]),
        ),
      () => asAnon((q) => q.query("select public.ai_credit_hold($1, $2, $3, 0, 1, 1)", [owner.id, MONTH, day])),
      () => asUser(owner, (q) => q.query("select public.ai_credit_settle($1, $2, $3, -500)", [owner.id, MONTH, day])),
      () => asAnon((q) => q.query("select public.ai_credit_settle($1, $2, $3, -500)", [owner.id, MONTH, day])),
      () => asUser(owner, (q) => q.query("select * from public.ai_credit_usage")),
      () => asUser(owner, (q) => q.query("select * from public.ai_platform_usage")),
      () => asUser(owner, (q) => q.query("delete from public.ai_credit_usage where owner_id = $1", [owner.id])),
      () => asUser(owner, (q) => q.query("update public.ai_platform_usage set used_micros = 0")),
      () =>
        asUser(owner, (q) =>
          q.query("insert into public.ai_credit_usage (owner_id, period) values ($1, '2026-12-01')", [owner.id]),
        ),
    ]) {
      expect(await expectDbError(run)).toContain("permission denied");
    }
    expect(await store(owner.id)).toEqual({ used_micros: "500", calls: 1 });
  });
});

describe("profiles.ai_suggest_as_you_type", () => {
  it("is on for everyone until they turn it off, which they may do themselves", async () => {
    const person = await createUser();
    const before = await asUser(person, (q) =>
      q.query("select ai_suggest_as_you_type from public.profiles where id = $1", [person.id]),
    );
    expect(before.rows[0]).toEqual({ ai_suggest_as_you_type: true });
    await asUser(person, (q) => q.query("update public.profiles set ai_suggest_as_you_type = false where id = $1", [person.id]));
    const after = await asSuper((q) => q.query("select ai_suggest_as_you_type from public.profiles where id = $1", [person.id]));
    expect(after.rows[0]).toEqual({ ai_suggest_as_you_type: false });
  });
});

describe("the pricing funnel", () => {
  it("takes the AI upsell as an entry point", async () => {
    const owner = await createUser();
    await asService((q) =>
      q.query("insert into public.seller_funnel_events (account_id, kind, source) values ($1, 'pricing_viewed', 'ai_writing')", [
        owner.id,
      ]),
    );
  });
});
