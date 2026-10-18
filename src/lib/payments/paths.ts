/** Where the payments feature's own routes live, in one place. Pure strings,
 *  safe on the server and the client. The Payments page itself is
 *  PAYMENTS_PATH in lib/dashboard/paths.ts, with the other sections. */

/** Where Stripe sends a seller back to after (or out of) its hosted
 *  onboarding. Re-reads the account from Stripe, then lands on Payments. */
export const PAYMENTS_CONNECT_RETURN_PATH = "/api/payments/connect/return";

/** Stripe Connect's events: payments, refunds and disputes on sellers' own
 *  accounts. Not the Billing webhook (lib/billing/paths.ts), which is about
 *  the plans sellers pay us for. */
export const PAYMENTS_WEBHOOK_PATH = "/api/payments/webhook";
