// SERVER ONLY. A thin client for the handful of Stripe Billing calls this app
// makes, on the PLATFORM account.
//
// WHY NOT THE `stripe` PACKAGE. The Worker bundle is close to OpenNext's size
// limit (see the same decision in lib/r2.ts, which uses aws4fetch rather than
// the AWS SDK). Billing needs seven endpoints, form-encoded requests and JSON
// back; that is a page of code, not a dependency.
//
// THE API VERSION IS PINNED. Stripe changes response shapes between versions
// (from `basil` on, a subscription's billing period lives on its ITEMS, not on
// the subscription). Every request sends STRIPE_API_VERSION, and the types
// below describe exactly that version, so an account-level default changed in
// the Stripe dashboard can never change what this code reads.
//
// Only the fields this app reads are typed. Nothing here is logged: request
// bodies carry customer details, and the URLs Stripe returns (Checkout,
// Customer Portal) are bearer links to a seller's billing.

/** The Stripe API version every request is made against. */
export const STRIPE_API_VERSION = "2025-08-27.basil";

const STRIPE_API_BASE = "https://api.stripe.com/v1";

/** Whether the configured key is a live-mode one (sk_live_ / rk_live_). Test-
 *  mode events are ignored by a live deployment, and the other way round. */
export function stripeKeyIsLive(): boolean {
  return /^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY ?? "");
}

/** Parameters as Stripe's form encoding takes them: nested objects and arrays. */
export type StripeParams = {
  [key: string]: string | number | boolean | null | undefined | StripeParams | StripeParams[] | string[];
};

/** A failure Stripe reported. `code`/`type` are Stripe's own, for branching. */
export class StripeApiError extends Error {
  constructor(
    readonly status: number,
    readonly type: string | undefined,
    readonly code: string | undefined,
    readonly param: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "StripeApiError";
  }
}

// ---- Response shapes (API version STRIPE_API_VERSION, fields read here only) ----

export type StripePrice = {
  id: string;
  lookup_key: string | null;
  unit_amount: number | null;
  currency: string;
  active: boolean;
  recurring: { interval: "day" | "week" | "month" | "year"; interval_count: number } | null;
};

export type StripeSubscriptionItem = {
  id: string;
  price: StripePrice;
  quantity?: number;
  current_period_end: number;
};

export type StripeSubscription = {
  id: string;
  customer: string;
  status: string;
  created: number;
  cancel_at_period_end: boolean;
  canceled_at: number | null;
  livemode: boolean;
  metadata: Record<string, string>;
  items: { data: StripeSubscriptionItem[] };
};

export type StripeCustomer = { id: string; livemode: boolean };

export type StripeCheckoutSession = {
  id: string;
  url: string | null;
  customer: string | null;
  subscription: string | null;
  client_reference_id: string | null;
  mode: string;
  status: string | null;
};

export type StripePortalSession = { id: string; url: string };

export type StripeList<T> = { data: T[]; has_more: boolean };

/**
 * Stripe's form encoding: `a[b][0][c]=x`. Undefined and null are left out;
 * booleans are "true"/"false", as Stripe expects.
 */
export function encodeStripeForm(params: StripeParams, prefix = "", into = new URLSearchParams()): URLSearchParams {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (typeof item === "object" && item !== null) {
          encodeStripeForm(item, `${name}[${index}]`, into);
        } else {
          into.append(`${name}[${index}]`, String(item));
        }
      });
    } else if (typeof value === "object") {
      encodeStripeForm(value, name, into);
    } else {
      into.append(name, String(value));
    }
  }
  return into;
}

/**
 * One call to Stripe. POSTs are form-encoded and carry `idempotencyKey` when
 * given, so a retried request (a double click, a redelivered webhook) cannot
 * create a second customer or session. Throws StripeApiError on a Stripe
 * error and plain Error on a transport failure; callers decide what a seller
 * is told.
 */
export async function stripeRequest<T>(
  method: "GET" | "POST",
  path: string,
  params: StripeParams = {},
  options: { idempotencyKey?: string } = {},
): Promise<T> {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error("STRIPE_SECRET_KEY is not set");

  const body = encodeStripeForm(params);
  const url = method === "GET" && [...body.keys()].length > 0 ? `${STRIPE_API_BASE}${path}?${body}` : `${STRIPE_API_BASE}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secret}`,
    "Stripe-Version": STRIPE_API_VERSION,
  };
  if (method === "POST") headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  const response = await fetch(url, {
    method,
    headers,
    body: method === "POST" ? body.toString() : undefined,
    // Never cached: every answer is about live billing state.
    cache: "no-store",
  });
  const json = (await response.json().catch(() => null)) as
    | (T & { error?: undefined })
    | { error?: { type?: string; code?: string; param?: string; message?: string } }
    | null;
  if (!response.ok || !json || (json as { error?: unknown }).error) {
    const error = (json as { error?: { type?: string; code?: string; param?: string; message?: string } } | null)?.error;
    throw new StripeApiError(
      response.status,
      error?.type,
      error?.code,
      error?.param,
      error?.message ?? `Stripe answered ${response.status}`,
    );
  }
  return json as T;
}
