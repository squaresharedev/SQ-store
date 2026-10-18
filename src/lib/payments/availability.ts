/**
 * Whether a seller can connect Stripe yet. ONE answer for every surface that
 * would otherwise send someone to a connect button that does nothing:
 *   - lib/dashboard/attention.ts only asks for a connection that can be made;
 *   - components/payments/ConnectStripeModal.tsx keeps "Continue to Stripe"
 *     disabled, marked Soon;
 *   - components/payments/ConnectionStatusCard.tsx says it is coming soon
 *     instead of offering a button into that modal;
 *   - lib/checkout/availability.ts offers no Stripe checkout;
 *   - components/orders/OrderRefund.tsx says the seller pays a refund back
 *     themselves.
 *
 * A dead end on the dashboard's first screen costs a new seller more than a
 * missing row does, which is why this is a switch rather than a TODO in each
 * place.
 *
 * THE SWITCH IS A PUBLIC, BUILD-TIME VARIABLE:
 *   NEXT_PUBLIC_STRIPE_CONNECT_ENABLED="true"   in .env.production
 * Public, because client components read it (the modal, the refund form), and
 * build-time for the same reason the Supabase URL is: a value a browser bundle
 * needs has to be in the bundle. It says only that the FEATURE is on. Whether
 * the server can actually reach Stripe is a separate, server-only question
 * (lib/payments/connect/config.ts), and both must be true before a seller is
 * offered anything.
 *
 * DO NOT SET IT until the Connect flow has been run against Stripe's own test
 * mode end to end. It has been built and tested against a simulated Stripe
 * (tests/e2e/87-stripe-connect.spec.ts) and has never talked to the real one.
 */
export const STRIPE_CONNECT_AVAILABLE = process.env.NEXT_PUBLIC_STRIPE_CONNECT_ENABLED === "true";
