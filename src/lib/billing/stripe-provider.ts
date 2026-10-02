// SERVER ONLY. Stripe Billing, on the PLATFORM account: Square Share bills the
// seller for their plan. (Buyers paying sellers is Stripe Connect, a separate
// integration that does not exist yet; see lib/payments/availability.ts.)
//
// Hosted pages only. A new subscription goes through Stripe Checkout; a plan
// switch, a cancellation, a new card and the invoice history go through the
// Stripe Customer Portal. No card number, address or invoice ever passes
// through this app.
//
// PRICES ARE CHECKED, NOT TRUSTED. The price a checkout charges is looked up
// by the lookup key in lib/billing/plans.ts and must charge exactly what that
// catalog (and so the plans page) says: same amount, same currency, same
// interval. A mismatch refuses the checkout (BillingConfigError) instead of
// charging a seller a price they were not shown.

import { toStripeLocale } from "@/lib/billing/stripe-locale";
import {
  BILLING_CURRENCY,
  PLANS,
  type BillingInterval,
  type PaidPlanId,
} from "@/lib/billing/plans";
import {
  BillingConfigError,
  type BillingCustomerDetails,
  type BillingProvider,
  type CheckoutRequest,
  type PortalRequest,
} from "@/lib/billing/provider";
import {
  StripeApiError,
  stripeKeyIsLive,
  stripeRequest,
  type StripeCheckoutSession,
  type StripeCustomer,
  type StripeList,
  type StripePortalSession,
  type StripePrice,
  type StripeParams,
  type StripeSubscription,
} from "@/lib/billing/stripe-api";
import {
  applyBillingSnapshot,
  emptySnapshot,
  normalizeSubscription,
  pickCurrentSubscription,
} from "@/lib/billing/sync";

/** The active Stripe price for a plan and interval, checked against the catalog. */
async function catalogPrice(plan: PaidPlanId, interval: BillingInterval): Promise<StripePrice> {
  const lookupKey = PLANS[plan].lookupKey?.[interval];
  if (!lookupKey) throw new BillingConfigError(`no lookup key for ${plan}/${interval}`);
  const prices = await stripeRequest<StripeList<StripePrice>>("GET", "/prices", {
    lookup_keys: [lookupKey],
    active: true,
    limit: 1,
  });
  const price = prices.data[0];
  if (!price) throw new BillingConfigError(`no active Stripe price with lookup key ${lookupKey}`);
  const expected = PLANS[plan].priceCents[interval];
  if (
    price.unit_amount !== expected ||
    price.currency.toUpperCase() !== BILLING_CURRENCY ||
    price.recurring?.interval !== interval ||
    price.recurring.interval_count !== 1
  ) {
    throw new BillingConfigError(
      `Stripe price ${price.id} (${lookupKey}) does not match plans.ts: ` +
        `${price.unit_amount} ${price.currency}/${price.recurring?.interval} vs ${expected} ${BILLING_CURRENCY}/${interval}`,
    );
  }
  return price;
}

/** Every subscription a customer has, newest first as Stripe lists them. */
async function customerSubscriptions(customerId: string): Promise<StripeSubscription[]> {
  const list = await stripeRequest<StripeList<StripeSubscription>>("GET", "/subscriptions", {
    customer: customerId,
    status: "all",
    limit: 20,
  });
  return list.data;
}

/**
 * Re-read a customer's subscriptions and write the one that decides their
 * plan. Stamped BEFORE asking: whatever comes back is at least this fresh, so
 * a sync that started later can never be overwritten by one that started
 * earlier and answered slower.
 */
async function syncStripeCustomer(ownerId: string, customerId: string) {
  const syncedAt = new Date();
  const current = pickCurrentSubscription(await customerSubscriptions(customerId));
  const snapshot = current ? normalizeSubscription(current, syncedAt) : emptySnapshot(stripeKeyIsLive());
  return applyBillingSnapshot(ownerId, customerId, snapshot, syncedAt);
}

export const stripeBillingProvider: BillingProvider = {
  id: "stripe",

  async createCustomer(details: BillingCustomerDetails): Promise<string> {
    const base: StripeParams = {
      email: details.email ?? undefined,
      name: details.name ?? undefined,
      preferred_locales: [toStripeLocale(details.locale)],
      metadata: { owner_id: details.ownerId },
      ...(details.country ? { address: { country: details.country } } : {}),
    };
    // Keyed on the account, so two tabs (or a retried request) racing to
    // create the customer get the same one back from Stripe for 24 hours.
    const key = `customer-${details.ownerId}`;
    if (details.vatId) {
      try {
        const customer = await stripeRequest<StripeCustomer>(
          "POST",
          "/customers",
          { ...base, tax_id_data: [{ type: "eu_vat", value: details.vatId }] },
          { idempotencyKey: `${key}-vat` },
        );
        return customer.id;
      } catch (error) {
        // A VAT ID Stripe cannot parse must not stand between a seller and
        // their upgrade: they can add it in Checkout or the portal. Anything
        // other than a problem with that one field is a real failure.
        if (!(error instanceof StripeApiError && error.param?.startsWith("tax_id_data"))) throw error;
        console.warn("[billing] Stripe refused the stored VAT ID; creating the customer without it");
      }
    }
    const customer = await stripeRequest<StripeCustomer>("POST", "/customers", base, { idempotencyKey: key });
    return customer.id;
  },

  async createCheckout(request: CheckoutRequest): Promise<string> {
    const price = await catalogPrice(request.plan, request.interval);
    const session = await stripeRequest<StripeCheckoutSession>("POST", "/checkout/sessions", {
      mode: "subscription",
      customer: request.customerId,
      client_reference_id: request.ownerId,
      line_items: [{ price: price.id, quantity: 1 }],
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
      locale: toStripeLocale(request.locale),
      // VAT: Stripe Tax works out the rate (or the reverse charge for a valid
      // EU VAT ID) from the billing address it collects here.
      automatic_tax: { enabled: true },
      tax_id_collection: { enabled: true },
      billing_address_collection: "required",
      customer_update: { address: "auto", name: "auto" },
      allow_promotion_codes: true,
      subscription_data: { metadata: { owner_id: request.ownerId } },
      metadata: { owner_id: request.ownerId },
    });
    if (!session.url) throw new Error("Stripe returned a checkout session without a URL");
    return session.url;
  },

  async createPortal(request: PortalRequest): Promise<string> {
    const params: StripeParams = {
      customer: request.customerId,
      return_url: request.returnUrl,
      locale: toStripeLocale(request.locale),
    };
    const afterCompletion = { type: "redirect", redirect: { return_url: request.returnUrl } };

    if (request.flow.kind !== "manage") {
      if (!request.subscriptionId) throw new BillingConfigError("no subscription to change");
      const subscription = await stripeRequest<StripeSubscription>(
        "GET",
        `/subscriptions/${encodeURIComponent(request.subscriptionId)}`,
      );
      if (subscription.customer !== request.customerId) {
        // The stored subscription belongs to someone else: never open it.
        throw new BillingConfigError("stored subscription does not belong to the stored customer");
      }
      if (request.flow.kind === "switch") {
        const item = subscription.items.data[0];
        if (!item) throw new BillingConfigError("subscription has no item to switch");
        const price = await catalogPrice(request.flow.plan, request.flow.interval);
        params.flow_data = {
          type: "subscription_update_confirm",
          subscription_update_confirm: {
            subscription: subscription.id,
            items: [{ id: item.id, price: price.id, quantity: 1 }],
          },
          after_completion: afterCompletion,
        };
      } else {
        params.flow_data = {
          type: "subscription_cancel",
          subscription_cancel: { subscription: subscription.id },
          after_completion: afterCompletion,
        };
      }
    }

    const session = await stripeRequest<StripePortalSession>("POST", "/billing_portal/sessions", params);
    return session.url;
  },

  syncCustomer: syncStripeCustomer,

  async scheduleCancellation(ownerId: string, customerId: string, subscriptionId: string): Promise<void> {
    const subscription = await stripeRequest<StripeSubscription>(
      "GET",
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
    );
    if (subscription.customer !== customerId) {
      throw new BillingConfigError("stored subscription does not belong to the stored customer");
    }
    await stripeRequest<StripeSubscription>(
      "POST",
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
      { cancel_at_period_end: true },
      { idempotencyKey: `cancel-at-period-end-${subscriptionId}` },
    );
    await syncStripeCustomer(ownerId, customerId);
  },

  async checkoutSessionCustomer(sessionId: string): Promise<string | null> {
    const session = await stripeRequest<StripeCheckoutSession>(
      "GET",
      `/checkout/sessions/${encodeURIComponent(sessionId)}`,
    );
    return session.customer;
  },
};
