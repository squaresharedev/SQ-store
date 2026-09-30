// @vitest-environment node
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SIGNATURE_TOLERANCE_SECONDS, verifyStripeSignature } from "@/lib/billing/webhook-signature";
import { customerOfEvent, parseStripeEvent } from "@/lib/billing/webhook";
import { encodeStripeForm } from "@/lib/billing/stripe-api";

const SECRET = "whsec_test_secret";
const NOW = 1_790_000_000;
const BODY = JSON.stringify({ id: "evt_1", type: "invoice.paid" });

/** A header exactly as Stripe builds it, signed with Node's own HMAC. */
function header(body: string, timestamp = NOW, secret = SECRET): string {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

describe("verifyStripeSignature", () => {
  it("accepts a genuine, recent signature", async () => {
    expect(await verifyStripeSignature(BODY, header(BODY), [SECRET], NOW)).toEqual({ ok: true });
  });

  it("refuses a body changed after signing", async () => {
    const tampered = BODY.replace("invoice.paid", "invoice.payment_failed");
    expect(await verifyStripeSignature(tampered, header(BODY), [SECRET], NOW)).toEqual({ ok: false, reason: "mismatch" });
  });

  it("refuses another endpoint's secret", async () => {
    expect(await verifyStripeSignature(BODY, header(BODY, NOW, "whsec_other"), [SECRET], NOW)).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("refuses a genuine request replayed outside the tolerance", async () => {
    const old = NOW - SIGNATURE_TOLERANCE_SECONDS - 1;
    expect(await verifyStripeSignature(BODY, header(BODY, old), [SECRET], NOW)).toEqual({ ok: false, reason: "stale" });
  });

  it("refuses a missing or malformed header", async () => {
    expect(await verifyStripeSignature(BODY, null, [SECRET], NOW)).toEqual({ ok: false, reason: "missing" });
    expect(await verifyStripeSignature(BODY, "v1=abc", [SECRET], NOW)).toEqual({ ok: false, reason: "malformed" });
    expect(await verifyStripeSignature(BODY, header(BODY), [], NOW)).toEqual({ ok: false, reason: "missing" });
  });

  it("accepts either secret while one is being rotated", async () => {
    const both = `${header(BODY, NOW, "whsec_new")},v1=${"0".repeat(64)}`;
    expect(await verifyStripeSignature(BODY, both, ["whsec_old", "whsec_new"], NOW)).toEqual({ ok: true });
  });
});

describe("parseStripeEvent", () => {
  it("reads a well-formed event", () => {
    const event = parseStripeEvent(
      JSON.stringify({ id: "evt_1", type: "customer.subscription.updated", livemode: false, data: { object: { customer: "cus_1" } } }),
    );
    expect(event?.id).toBe("evt_1");
  });

  it("refuses anything else", () => {
    expect(parseStripeEvent("not json")).toBeNull();
    expect(parseStripeEvent(JSON.stringify({ id: "nope", type: "x", livemode: false, data: { object: {} } }))).toBeNull();
    expect(parseStripeEvent(JSON.stringify({ id: "evt_1", type: "x", data: { object: {} } }))).toBeNull();
  });
});

describe("customerOfEvent", () => {
  const event = (type: string, object: Record<string, unknown>) =>
    parseStripeEvent(JSON.stringify({ id: "evt_1", type, livemode: false, data: { object } }))!;

  it("reads the customer a subscription, invoice or session names", () => {
    expect(customerOfEvent(event("customer.subscription.updated", { id: "sub_1", customer: "cus_1" }))).toBe("cus_1");
    expect(customerOfEvent(event("invoice.paid", { id: "in_1", customer: { id: "cus_2" } }))).toBe("cus_2");
  });

  it("reads a customer event's own id", () => {
    expect(customerOfEvent(event("customer.updated", { id: "cus_3" }))).toBe("cus_3");
  });

  it("is null when the event names no customer", () => {
    expect(customerOfEvent(event("invoice.paid", { id: "in_1" }))).toBeNull();
  });
});

describe("encodeStripeForm", () => {
  it("encodes nested objects and arrays the way Stripe reads them, leaving out empties", () => {
    const form = encodeStripeForm({
      mode: "subscription",
      line_items: [{ price: "price_1", quantity: 1 }],
      automatic_tax: { enabled: true },
      lookup_keys: ["pro_month_eur_v1"],
      email: undefined,
      name: null,
    });
    expect([...form.entries()]).toEqual([
      ["mode", "subscription"],
      ["line_items[0][price]", "price_1"],
      ["line_items[0][quantity]", "1"],
      ["automatic_tax[enabled]", "true"],
      ["lookup_keys[0]", "pro_month_eur_v1"],
    ]);
  });
});
