import { OPTION_GROUPS_MAX } from "@/types/product";

// THE CART'S LIMITS, client-safe. One place, read by the cart store, the
// cart and checkout routes, the order writer and (mirrored) the database's
// CHECKs in supabase/migrations/20261120_shopping_cart.sql.

/** The most different lines one cart, and so one order, can hold. A line is a
 *  product in one version; the same product in two versions is two lines.
 *  Far under Stripe Checkout's 100 line items (one per line, plus delivery). */
export const CART_LINES_MAX = 20;

/** How long a cart nobody touches is kept, in days. Long enough to come back
 *  to after a weekend; short enough that the browser keeps nothing for long
 *  (the storage is "strictly necessary" only while it serves the cart). */
export const CART_IDLE_DAYS = 14;

/** "Goes well with": how many products the cart suggests at most, and how
 *  many of the cart's add-on picks it looks at to find them (a bound on one
 *  read, whatever the cart holds). */
export const CART_SUGGESTIONS_MAX = 3;
export const CART_SUGGESTION_CANDIDATES_MAX = 12;

/** A line names one option per group, so never more ids than groups. */
export const CART_OPTIONS_PER_LINE = OPTION_GROUPS_MAX;
