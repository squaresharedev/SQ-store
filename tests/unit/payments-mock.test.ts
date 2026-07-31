// @vitest-environment node
/**
 * Payments are a UI-complete Stripe MOCK by design (Phase 2). These tests
 * pin the two security-critical properties:
 *   1. No code path performs any network call — nothing can hit
 *      api.stripe.com (or anywhere else) from the payments layer.
 *   2. No payments component collects sensitive financial input — no field
 *      for card/bank/routing/IBAN/SSN exists anywhere.
 * If Stripe Connect gets wired for real, these tests should be REPLACED by
 * integration tests against stripe-mock, not deleted silently.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAccountStatus,
  getBalance,
  getPaymentsOverview,
  getPayoutMethod,
  getUpcomingPayout,
  listBalanceTransactions,
  listPayouts,
} from "@/lib/payments/mock";

const SRC = join(__dirname, "..", "..", "src");

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listFiles(join(dir, entry.name))
      : [join(dir, entry.name)],
  );
}

const sourceFiles = listFiles(SRC).filter((f) => /\.(ts|tsx)$/.test(f));

describe("no live Stripe anywhere in the app source", () => {
  it("no file references a Stripe API host or secret key prefix", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const text = readFileSync(file, "utf8");
      if (/api\.stripe\.com|\bsk_live_|\bsk_test_|\brk_live_/.test(text)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the stripe SDK is not a dependency and is never imported", () => {
    const pkg = JSON.parse(
      readFileSync(join(SRC, "..", "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain("stripe");
    expect(Object.keys(pkg.devDependencies ?? {})).not.toContain("stripe");

    const importers = sourceFiles.filter((f) =>
      /from\s+["']stripe["']|require\(["']stripe["']\)/.test(readFileSync(f, "utf8")),
    );
    expect(importers).toEqual([]);
  });
});

describe("payments components collect no sensitive financial input", () => {
  const paymentsDir = join(SRC, "components", "payments");
  const paymentFiles = listFiles(paymentsDir);

  // Field-name shapes that must never appear as input names/ids/labels.
  const SENSITIVE =
    /name=["'][^"']*(card[_-]?number|cardnum|cvc|cvv|routing|iban|account[_-]?number|ssn|sort[_-]?code)["']/i;

  it("no payments component renders a sensitive input field", () => {
    const offenders = paymentFiles.filter((f) => SENSITIVE.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("payments components render no <input> elements at all except none expected", () => {
    // Today the payments UI is read-only (masked last4 display). If an input
    // appears here in the future this test forces a conscious review.
    const withInputs = paymentFiles.filter((f) =>
      /<input[\s>]/i.test(readFileSync(f, "utf8")),
    );
    expect(withInputs).toEqual([]);
  });
});

describe("mock layer performs zero network calls", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("network call attempted from payments mock");
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("every mock function resolves without touching the network", async () => {
    const [status, balance, upcoming, method, payouts, txns, overview] =
      await Promise.all([
        getAccountStatus(),
        getBalance(),
        getUpcomingPayout(),
        getPayoutMethod(),
        listPayouts(),
        listBalanceTransactions(),
        getPaymentsOverview(),
      ]);
    expect(fetch).not.toHaveBeenCalled();

    // Data is Stripe-shaped demo content, never real account material.
    expect(status.accountId).toMatch(/^acct_demo_/);
    expect(balance.available.length).toBeGreaterThan(0);
    expect(method?.last4).toMatch(/^\d{4}$/);
    expect(payouts.every((p) => p.id.startsWith("po_demo_"))).toBe(true);
    expect(txns.every((t) => t.id.startsWith("txn_demo_"))).toBe(true);
    expect(upcoming === null || typeof upcoming.amountCents === "number").toBe(true);
    expect(overview.account.accountId).toMatch(/^acct_demo_/);
  });

  it("payout method exposes at most last4 — never a full account number", () => {
    const files = listFiles(join(SRC, "lib", "payments"));
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      // 8+ consecutive digits would smell like a real account/card number.
      const suspicious = text.match(/\b\d{8,}\b/g) ?? [];
      // Allow obvious non-account numbers (timestamps in cents, etc.) — there
      // should simply be none in the payments mock today.
      expect(suspicious, f).toEqual([]);
    }
  });
});
