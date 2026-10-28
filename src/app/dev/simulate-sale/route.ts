import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import {
  SIMULATE_SALE_PATH,
  buyerStorefrontFor,
  deleteSimulatedReviews,
  simulatableProducts,
  simulateSale,
  type SimulatedSaleRequest,
} from "@/lib/dev/simulated-sale";
import { orderDetailPath } from "@/lib/orders/paths";
import { orderLinkPath } from "@/lib/orders/order-link";
import { PLACED_QUERY_PARAM } from "@/lib/storefront/product-page-url";
import { escapeHtml } from "@/lib/format/html";

/**
 * /dev/simulate-sale: record a pretend paid order for one of YOUR products,
 * through the real order writer (lib/dev/simulated-sale.ts).
 *
 *   GET   a bare page listing your active products, two buttons each.
 *   POST  form post (the page) -> 303 to the new order's panel, or with
 *         view=buyer to the BUYER'S thank-you page, as if they had just paid:
 *         the way to try what a buyer sees after buying (the review ask
 *         included) without buying anything. action=clear-reviews deletes the
 *         reviews written from pretend orders.
 *         JSON post { productId?, quantity?, buyer?, checkoutSessionId?, view? }
 *         -> { orderId, duplicate, orderUrl? } (e2e). Repeating a
 *         checkoutSessionId replays that payment, like a redelivered webhook.
 *
 * DEVELOPMENT ONLY, and 404 everywhere else, like /dev/outbox. Unlike the
 * galleries under /dev it needs a signed-in seller who can write products in
 * the active store: it writes an order into that store and nowhere else.
 * In production no order exists that nobody paid for, so no review can either.
 */

function notFound(): Response {
  return new Response(null, { status: 404 });
}

function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { location } });
}

async function sellerAccount() {
  const account = await getActiveAccount();
  return account && can(account.role, "products.write") ? account : null;
}

/** Where "Buy as a buyer" lands: the order page straight after paying. */
async function buyerOrderUrl(storefrontId: string, orderId: string): Promise<string | null> {
  const path = await orderLinkPath(storefrontId, orderId);
  return path ? `${path}?${PLACED_QUERY_PARAM}=1` : null;
}

export async function GET(request: Request): Promise<Response> {
  if (process.env.NODE_ENV !== "development") return notFound();
  const account = await sellerAccount();
  if (!account) return new Response("Sign in as a seller first.", { status: 401 });

  const cleared = new URL(request.url).searchParams.get("cleared");
  const products = await simulatableProducts(account.accountId);
  const rows = products
    .map(
      (product) => `
      <li>
        <form method="post">
          <input type="hidden" name="productId" value="${escapeHtml(product.id)}">
          <span>${escapeHtml(product.title)}${product.digital_file_key ? " (download)" : ""}</span>
          <label>Qty <input name="quantity" type="number" min="1" max="100" value="1"></label>
          <button type="submit">Simulate a sale</button>
          <button type="submit" name="view" value="buyer">Buy as a buyer</button>
        </form>
      </li>`,
    )
    .join("");
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Simulate a sale</title>
    <style>body{font:14px system-ui;margin:2rem;max-width:48rem}li{margin:.5rem 0}form{display:flex;gap:.75rem;align-items:center;flex-wrap:wrap}input[type=number]{width:4rem}</style>
    <h1>Simulate a sale</h1>
    <p>Records a paid order through the real order writer. Mail lands in <a href="/dev/outbox">/dev/outbox</a>.</p>
    <p><b>Buy as a buyer</b> opens the thank-you page the buyer lands on after paying, with the review form live. Nothing is charged.</p>
    <ul>${rows || "<li>No active products in this store.</li>"}</ul>
    <h2>Test reviews</h2>
    <p>Reviews written from these pretend orders are real rows: they show on the product page like any other.</p>
    <form method="post">
      <input type="hidden" name="action" value="clear-reviews">
      <button type="submit">Delete reviews from pretend orders</button>
      ${cleared === null ? "" : `<span role="status">${cleared === "failed" ? "Could not delete them. Try again." : `Deleted ${escapeHtml(cleared)}.`}</span>`}
    </form>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

export async function POST(request: Request): Promise<Response> {
  if (process.env.NODE_ENV !== "development") return notFound();
  const account = await sellerAccount();
  if (!account) return Response.json({ error: "Sign in as a seller first." }, { status: 401 });

  const isJson = request.headers.get("content-type")?.includes("application/json") ?? false;
  let sale: SimulatedSaleRequest;
  let asBuyer: boolean;
  if (isJson) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    sale = {
      productId: typeof body.productId === "string" ? body.productId : undefined,
      quantity: typeof body.quantity === "number" ? body.quantity : undefined,
      buyer: typeof body.buyer === "number" ? body.buyer : undefined,
      checkoutSessionId:
        typeof body.checkoutSessionId === "string" ? body.checkoutSessionId : undefined,
    };
    asBuyer = body.view === "buyer";
  } else {
    const form = await request.formData();
    if (form.get("action") === "clear-reviews") {
      const deleted = await deleteSimulatedReviews(account.accountId);
      return seeOther(`${SIMULATE_SALE_PATH}?cleared=${deleted ?? "failed"}`);
    }
    sale = {
      productId: String(form.get("productId") ?? "") || undefined,
      quantity: Number(form.get("quantity")) || undefined,
    };
    asBuyer = form.get("view") === "buyer";
  }

  let storefrontId: string | null = null;
  if (asBuyer) {
    const productId = sale.productId ?? (await simulatableProducts(account.accountId))[0]?.id;
    storefrontId = productId ? await buyerStorefrontFor(account.accountId, productId) : null;
    if (!storefrontId) return Response.json({ error: "no_storefront" }, { status: 400 });
    sale = { ...sale, productId, storefrontId };
  }

  const result = await simulateSale(account.accountId, sale);
  if (!result.ok) return Response.json({ error: result.reason }, { status: 400 });
  const orderUrl = storefrontId ? await buyerOrderUrl(storefrontId, result.orderId) : null;
  if (isJson) {
    return Response.json({ orderId: result.orderId, duplicate: result.duplicate, ...(orderUrl ? { orderUrl } : {}) });
  }
  return seeOther(orderUrl ?? orderDetailPath(result.orderId));
}
