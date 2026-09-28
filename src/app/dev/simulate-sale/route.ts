import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import {
  simulatableProducts,
  simulateSale,
  type SimulatedSaleRequest,
} from "@/lib/dev/simulated-sale";
import { orderDetailPath } from "@/lib/orders/paths";
import { escapeHtml } from "@/lib/format/html";

/**
 * /dev/simulate-sale: record a pretend paid order for one of YOUR products,
 * through the real order writer (lib/dev/simulated-sale.ts).
 *
 *   GET   a bare page listing your active products, one button each.
 *   POST  form post (the page) -> 303 to the new order's panel;
 *         JSON post { productId?, quantity?, buyer?, checkoutSessionId? }
 *         -> { orderId, duplicate } (e2e). Repeating a checkoutSessionId
 *         replays that payment, like a redelivered webhook.
 *
 * DEVELOPMENT ONLY, and 404 everywhere else, like /dev/outbox. Unlike the
 * galleries under /dev it needs a signed-in seller who can write products in
 * the active store: it writes an order into that store and nowhere else.
 */

function notFound(): Response {
  return new Response(null, { status: 404 });
}

async function sellerAccount() {
  const account = await getActiveAccount();
  return account && can(account.role, "products.write") ? account : null;
}

export async function GET(): Promise<Response> {
  if (process.env.NODE_ENV !== "development") return notFound();
  const account = await sellerAccount();
  if (!account) return new Response("Sign in as a seller first.", { status: 401 });

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
        </form>
      </li>`,
    )
    .join("");
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Simulate a sale</title>
    <style>body{font:14px system-ui;margin:2rem}li{margin:.5rem 0}form{display:flex;gap:.75rem;align-items:center}input[type=number]{width:4rem}</style>
    <h1>Simulate a sale</h1>
    <p>Records a paid order through the real order writer. Mail lands in <a href="/dev/outbox">/dev/outbox</a>.</p>
    <ul>${rows || "<li>No active products in this store.</li>"}</ul>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

export async function POST(request: Request): Promise<Response> {
  if (process.env.NODE_ENV !== "development") return notFound();
  const account = await sellerAccount();
  if (!account) return Response.json({ error: "Sign in as a seller first." }, { status: 401 });

  const isJson = request.headers.get("content-type")?.includes("application/json") ?? false;
  let sale: SimulatedSaleRequest;
  if (isJson) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    sale = {
      productId: typeof body.productId === "string" ? body.productId : undefined,
      quantity: typeof body.quantity === "number" ? body.quantity : undefined,
      buyer: typeof body.buyer === "number" ? body.buyer : undefined,
      checkoutSessionId:
        typeof body.checkoutSessionId === "string" ? body.checkoutSessionId : undefined,
    };
  } else {
    const form = await request.formData();
    sale = {
      productId: String(form.get("productId") ?? "") || undefined,
      quantity: Number(form.get("quantity")) || undefined,
    };
  }

  const result = await simulateSale(account.accountId, sale);
  if (!result.ok) return Response.json({ error: result.reason }, { status: 400 });
  if (isJson) return Response.json({ orderId: result.orderId, duplicate: result.duplicate });
  return new Response(null, {
    status: 303,
    headers: { location: orderDetailPath(result.orderId) },
  });
}
