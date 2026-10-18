// SERVER ONLY. Whether this deployment can actually talk to Stripe Connect.
//
// Two switches, deliberately:
//   - STRIPE_CONNECT_AVAILABLE (lib/payments/availability.ts): the FEATURE is
//     on. Public and build-time, because client components read it.
//   - stripeConnectConfigured() here: the SERVER holds what it needs. Secrets,
//     so server only.
// A seller is offered a connection, and a buyer a Stripe checkout, only when
// both are true (stripeConnectLive).
//
// THE SECRETS (`wrangler secret put <NAME>`, never in a file):
//   STRIPE_SECRET_KEY              the platform's key. The same one Stripe
//                                  Billing uses (lib/billing): it needs, in
//                                  addition, write access to Accounts, Account
//                                  Links, Checkout Sessions and Refunds on
//                                  connected accounts.
//   STRIPE_CONNECT_WEBHOOK_SECRET  signing secret of the CONNECT endpoint at
//                                  https://<host>/api/payments/webhook. A
//                                  different endpoint from Billing's, with its
//                                  own secret: Stripe sends connected-account
//                                  events only to an endpoint created with
//                                  "Listen to events on Connected accounts".

import { STRIPE_CONNECT_AVAILABLE } from "@/lib/payments/availability";

/** Whether the server holds both Connect secrets. */
export function stripeConnectConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY) && Boolean(process.env.STRIPE_CONNECT_WEBHOOK_SECRET);
}

/** The feature is switched on AND the server can reach Stripe. */
export function stripeConnectLive(): boolean {
  return STRIPE_CONNECT_AVAILABLE && stripeConnectConfigured();
}

/** The Connect endpoint's signing secrets (comma-separated while rotating). */
export function connectWebhookSecrets(): string[] {
  return (process.env.STRIPE_CONNECT_WEBHOOK_SECRET ?? "")
    .split(",")
    .map((secret) => secret.trim())
    .filter(Boolean);
}
