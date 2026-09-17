/**
 * Whether a seller can connect Stripe yet. ONE answer for every surface that
 * would otherwise send someone to a connect button that does nothing:
 *   - lib/dashboard/attention.ts only asks for a connection that can be made;
 *   - components/payments/ConnectStripeModal.tsx keeps "Continue to Stripe"
 *     disabled, marked Soon;
 *   - components/payments/ConnectionStatusCard.tsx says it is coming soon
 *     instead of offering a button into that modal.
 *
 * A dead end on the dashboard's first screen costs a new seller more than a
 * missing row does, which is why this is a switch rather than a TODO in each
 * place. Flip it in the same change that wires Stripe Connect onboarding
 * (TODO(stripe) in ConnectStripeModal), never before.
 */
export const STRIPE_CONNECT_AVAILABLE = false;
