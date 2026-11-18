// @vitest-environment node
/**
 * getAccountBilling produces the same result as readAccountBilling.
 *
 * Both derive from billingResultFromRows; this test verifies that the two
 * callers (the React-cached path via getAccountRow and the direct query path)
 * always agree, using the fake admin so the join logic is exercised without a
 * real database.
 *
 * Four fixture families:
 *   neither   no billing row, no plan grant  -> Free
 *   paid      billing row only               -> paid plan
 *   granted   no billing row, grant only     -> granted plan
 *   both      billing row + grant            -> higher of the two wins
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeAdmin } from "../setup/fake-admin";

// Make cache() a pass-through so the cached helpers are just the raw
// functions, keeping tests independent of React's render context.
vi.mock("react", async (importActual) => ({
  ...(await importActual<typeof import("react")>()),
  cache: <T>(fn: T) => fn,
}));

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// Dates far enough from any test run that "now" never crosses them.
const FUTURE = "2999-01-01T00:00:00Z";
const PAST   = "2020-01-01T00:00:00Z";

/** Minimal profiles row: only the id matters for the join key. */
function profileRow(id: string) {
  return {
    id,
    tax_business_name: null,
    tax_vat_id: null,
    tax_country: null,
    seller_address: null,
    seller_email: null,
    seller_phone: null,
    seller_phone_verified_at: null,
    seller_bio: null,
    seller_email_verified_at: null,
    shipping_policy: null,
  };
}

/** A seller_billing row for `ownerId` on the given plan, still active. */
function billingRow(ownerId: string, plan: "starter" | "pro") {
  return {
    owner_id: ownerId,
    plan,
    paid_until: FUTURE,
    status: "active",
    billing_interval: "month",
    price_cents: plan === "pro" ? 2900 : 900,
    currency: "eur",
    current_period_end: FUTURE,
    cancel_at_period_end: false,
    stripe_customer_id: "cus_test",
    stripe_subscription_id: "sub_test",
  };
}

/** A plan_grants row for `ownerId` on the given plan, no end date. */
function grantRow(ownerId: string, plan: "starter" | "pro") {
  return {
    owner_id: ownerId,
    plan,
    starts_at: PAST,
    ends_at: null,
  };
}

let fake = createFakeAdmin();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fake.admin }));

const { getAccountBilling } = await import("@/lib/billing/account-plan");
const { readAccountBilling } = await import("@/lib/billing/account-plan");

beforeEach(() => {
  fake = createFakeAdmin();
  vi.mocked(fake.admin);
});

function setup(tables: Parameters<typeof createFakeAdmin>[0]) {
  fake = createFakeAdmin(tables);
}

describe("getAccountBilling matches readAccountBilling", () => {
  it("neither billing row nor grant: both return Free", async () => {
    setup({ profiles: [profileRow(OWNER)] });
    const [via_row, direct] = await Promise.all([
      getAccountBilling(OWNER),
      readAccountBilling(OWNER),
    ]);
    expect(via_row).toEqual(direct);
    expect(via_row).toMatchObject({ ok: true, billing: { plan: "free", planSource: "free", grant: null } });
  });

  it("paid Pro subscription, no grant: both return Pro", async () => {
    setup({
      profiles: [profileRow(OWNER)],
      seller_billing: [billingRow(OWNER, "pro")],
    });
    const [via_row, direct] = await Promise.all([
      getAccountBilling(OWNER),
      readAccountBilling(OWNER),
    ]);
    expect(via_row).toEqual(direct);
    expect(via_row).toMatchObject({ ok: true, billing: { plan: "pro", planSource: "paid" } });
  });

  it("grant only (Starter), no billing row: both return Starter from grant", async () => {
    setup({
      profiles: [profileRow(OWNER)],
      plan_grants: [grantRow(OWNER, "starter")],
    });
    const [via_row, direct] = await Promise.all([
      getAccountBilling(OWNER),
      readAccountBilling(OWNER),
    ]);
    expect(via_row).toEqual(direct);
    expect(via_row).toMatchObject({ ok: true, billing: { plan: "starter", planSource: "granted" } });
  });

  it("Pro subscription + Starter grant: paid plan wins (Pro >= Starter, tie goes to paid)", async () => {
    setup({
      profiles: [profileRow(OWNER)],
      seller_billing: [billingRow(OWNER, "pro")],
      plan_grants: [grantRow(OWNER, "starter")],
    });
    const [via_row, direct] = await Promise.all([
      getAccountBilling(OWNER),
      readAccountBilling(OWNER),
    ]);
    expect(via_row).toEqual(direct);
    expect(via_row).toMatchObject({ ok: true, billing: { plan: "pro", planSource: "paid" } });
  });

  it("Starter subscription + Pro grant: grant wins (Pro > Starter)", async () => {
    setup({
      profiles: [profileRow(OWNER)],
      seller_billing: [billingRow(OWNER, "starter")],
      plan_grants: [grantRow(OWNER, "pro")],
    });
    const [via_row, direct] = await Promise.all([
      getAccountBilling(OWNER),
      readAccountBilling(OWNER),
    ]);
    expect(via_row).toEqual(direct);
    expect(via_row).toMatchObject({ ok: true, billing: { plan: "pro", planSource: "granted" } });
  });

  it("Pro subscription + Pro grant: paid plan wins (tie goes to paid)", async () => {
    setup({
      profiles: [profileRow(OWNER)],
      seller_billing: [billingRow(OWNER, "pro")],
      plan_grants: [grantRow(OWNER, "pro")],
    });
    const [via_row, direct] = await Promise.all([
      getAccountBilling(OWNER),
      readAccountBilling(OWNER),
    ]);
    expect(via_row).toEqual(direct);
    expect(via_row).toMatchObject({ ok: true, billing: { plan: "pro", planSource: "paid" } });
  });

  it("includes all billing fields in the result", async () => {
    setup({
      profiles: [profileRow(OWNER)],
      seller_billing: [billingRow(OWNER, "pro")],
    });
    const result = await getAccountBilling(OWNER);
    if (!result.ok) throw new Error("expected ok");
    const { billing } = result;
    // All the fields readAccountBilling maps must be present and correctly typed.
    expect(typeof billing.priceCents).toBe("number");
    expect(billing.currency).toBe("eur");
    expect(billing.cancelAtPeriodEnd).toBe(false);
    expect(billing.storedPlan).toBe("pro");
    expect(billing.status).toBe("active");
    expect(billing.interval).toBe("month");
  });
});
