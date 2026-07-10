/**
 * PLACEHOLDERS for STUB features (see TESTING_LOG.md inventory).
 * These are deliberately skipped: the features do not exist yet, so asserting
 * against them would test fiction. When a feature lands, un-skip and implement.
 */
import { describe, it } from "vitest";

describe.skip("checkout / order creation (STUB — no checkout exists)", () => {
  it.todo("creating an order decrements stock via decrementStock");
  it.todo("an order insert fires an 'order' notification to the seller");
  it.todo("a decrement crossing low_stock_threshold fires a 'stock' notification");
});

describe.skip("public embed API (STUB — widget served from embed.squareshare.to, endpoint not in this repo)", () => {
  it.todo("public config payload strips config.embed before serialization");
  it.todo("public payload NEVER contains owner_id, email, digital_file_key, buyer_email, or raw stock numbers");
  it.todo("blocks hidden by theme.hideSoldOut are dropped server-side, not client-side");
  it.todo("requests from origins outside embed.domains are refused when enabled=false");
  // NOTE: the stock-badge whitelist helpers that endpoint MUST use are already
  // tested for real in tests/unit/stock-badge.test.ts (PUBLIC_STOCK_SELECT +
  // toPublicStockBadge).
});

describe.skip("image proxy (STUB — no proxy route exists in this repo)", () => {
  it.todo("a files/ key is rejected with 403 (digital products must never be servable)");
  it.todo("only images/ keys belonging to a published product are proxied");
});

describe.skip("Stripe Connect (STUB — payments are a mock layer)", () => {
  it.todo("ConnectStripeModal starts a real OAuth onboarding flow");
  it.todo("refund action calls the refund API and transitions order status");
  it.todo("dispute action opens a dispute");
  it.todo("payout.failed generates a 'payment' notification");
});

describe.skip("team invite emails (STUB — console stub only)", () => {
  it.todo("inviting a non-user sends an invite email");
});

describe.skip("account hard delete (STUB — soft flag only)", () => {
  it.todo("a service-role job hard-deletes auth user, rows, and R2 objects");
});
