import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionState } from "@/lib/auth/session";
import { STEP_UP_WINDOW_SECONDS, secondFactorIsFresh } from "@/lib/auth/assurance";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { readAccountBilling } from "@/lib/billing/account-plan";

/**
 * GDPR data export. Streams everything we hold for the SIGNED-IN user,
 * profile, products, storefront config, as a downloadable JSON file.
 *
 * OWNER-SCOPED ONLY: the user id comes exclusively from the validated session
 * (never from query/body), every query filters on it, and RLS enforces the
 * same boundary underneath. There is no way to export someone else's data.
 *
 * RATE LIMITED: this is the single most expensive read in the app (three
 * parallel full-account queries), and it is a GET a script can loop. A person
 * exports their data a handful of times ever; the budget only bites automation.
 *
 * EXPLICIT COLUMNS, not select("*"): the export is the USER'S data, not the
 * system's bookkeeping about it. Internal columns stay out deliberately:
 *   - image_key / digital_file_key are R2 object paths (infrastructure
 *     addressing, and the file key is the thing the paywall protects);
 *   - embed_key is a live secret (the embed snippet credential) that does not
 *     belong in a JSON file sitting in a downloads folder;
 *   - is_seller / is_public and timestamps of internal flags are system state
 *     (onboarding_completed_at, when the welcome flow was seen, is one of them).
 * A new column is therefore NOT exported until someone decides it should be,
 * which is the right default for a file that leaves our custody.
 *
 * force-dynamic: not covered by settings/layout.tsx's auth gate (Route
 * Handlers sit outside the page/layout tree). See (dashboard)/layout.tsx for
 * why implicit cookies()-based dynamic detection isn't reliable here.
 */
export const dynamic = "force-dynamic";

const PROFILE_COLUMNS =
  "username, avatar_url, created_at, updated_at, " +
  "notify_sales, notify_reviews, notify_product_updates, notify_marketing, " +
  "tax_business_name, tax_vat_id, tax_country, " +
  "seller_address, seller_email, seller_email_verified_at, " +
  "seller_phone, seller_phone_verified_at, seller_bio, " +
  "legal_accepted_at, legal_accepted_version, deletion_requested_at";

const PRODUCT_COLUMNS =
  "id, title, description, price_cents, currency, status, " +
  "track_stock, stock_quantity, low_stock_threshold, max_per_order, created_at, updated_at";

// `brief` is the seller's own answers from the creation flow, so it belongs in
// their export. `embed_key` still does not: see the note above.
const STOREFRONT_COLUMNS = "id, name, config, brief, created_at, updated_at";

// The seller's own words and the plan they ended; the row id is bookkeeping.
const CANCELLATION_COLUMNS = "plan, billing_interval, reason, detail, ends_at, created_at, resumed_at";

// What the seller sold, as a record of THEIR trading: what, how much, our fee,
// and what became of it. The buyer's email and address are deliberately not
// here: they are another person's data, and the seller already has them where
// they are needed (the order itself, and the Orders page's own CSV export).
const ORDER_COLUMNS =
  "id, product_title, selected_options, quantity, amount_cents, shipping_cents, discount_cents, " +
  "platform_fee_cents, platform_fee_bps, currency, channel, status, fulfilment_status, " +
  "created_at, shipped_at, tracking_carrier, refunded_at, refund_reason";

// What we told them, and whether they read it.
const NOTIFICATION_COLUMNS = "type, title, body, read, created_at";

// The security log Settings shows them: what happened and when. The salted IP
// digest stays out (it identifies nothing to its owner, and is ours to rotate).
const SECURITY_EVENT_COLUMNS = "event, created_at";

// Who they invited to their store (the address is one THEY typed), and the
// stores they were invited to.
const OWN_TEAM_COLUMNS = "invited_email, role, status, invited_at, accepted_at";
const MEMBERSHIP_COLUMNS = "role, status, invited_at, accepted_at";

/**
 * The most rows of any one list in the file. Every list is newest first, so a
 * longer history loses its oldest entries, and the file says so
 * (`truncated`) rather than pass a part off as the whole.
 */
const EXPORT_ROWS_MAX = 1000;

export async function GET() {
  // Through the shared session gate, not a bare auth.getUser(): a session that
  // still owes its second factor reads as signed out here like everywhere else.
  const session = await getSessionState();
  if (session.kind === "unreachable") {
    return NextResponse.json(
      { error: "Couldn't reach the sign-in service. Try again in a minute." },
      { status: 503 },
    );
  }
  if (session.kind !== "signed_in") {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const { user, assurance } = session;

  // The whole account in one file is the most valuable thing a hijacked
  // session could walk off with. With 2FA on, it needs a code from the last
  // few minutes; the Danger zone's button asks for one first (confirmIdentity)
  // and then comes here.
  if (assurance.enrolled && !secondFactorIsFresh(assurance, STEP_UP_WINDOW_SECONDS)) {
    return NextResponse.json(
      { error: "Confirm it's you with a two-factor code, then download again." },
      { status: 403 },
    );
  }

  const supabase = await createClient();

  if (!(await rateLimit("dataExport", RATE_LIMITS.dataExport))) {
    return NextResponse.json(
      { error: "You've exported your data several times recently. Try again in an hour." },
      { status: 429 },
    );
  }

  const admin = createAdminClient();
  const [profile, products, storefronts, billing, cancellations, orders, notifications, securityEvents, ownTeam, memberships] = await Promise.all([
    supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", user.id).maybeSingle(),
    supabase.from("products").select(PRODUCT_COLUMNS).eq("owner_id", user.id),
    // A user can own MANY storefronts; export all of them, not just one.
    supabase.from("storefronts").select(STOREFRONT_COLUMNS).eq("owner_id", user.id),
    // The user's OWN plan (seller_billing has no client policy, so this is a
    // service-role read keyed on the session's user id, never a parameter).
    readAccountBilling(user.id),
    // What they told us when they cancelled a plan: their words, so theirs to
    // export. Service-role read keyed on the session's user id, like billing.
    admin
      .from("plan_cancellations")
      .select(CANCELLATION_COLUMNS)
      .eq("owner_id", user.id)
      .order("created_at", { ascending: true }),
    // The rest is read with the service role too, each keyed on the session's
    // user id and never on a parameter: the row-level rules on these tables
    // answer for the store being VIEWED (a teammate's included), and this file
    // is about the person holding the session and nobody else.
    admin
      .from("orders")
      .select(ORDER_COLUMNS)
      .eq("seller_id", user.id)
      .order("created_at", { ascending: false })
      .limit(EXPORT_ROWS_MAX),
    admin
      .from("notifications")
      .select(NOTIFICATION_COLUMNS)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(EXPORT_ROWS_MAX),
    admin
      .from("security_events")
      .select(SECURITY_EVENT_COLUMNS)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(EXPORT_ROWS_MAX),
    admin.from("team_members").select(OWN_TEAM_COLUMNS).eq("account_owner_id", user.id).limit(EXPORT_ROWS_MAX),
    admin.from("team_members").select(MEMBERSHIP_COLUMNS).eq("member_user_id", user.id).limit(EXPORT_ROWS_MAX),
  ]);
  if (
    profile.error ||
    products.error ||
    storefronts.error ||
    !billing.ok ||
    cancellations.error ||
    orders.error ||
    notifications.error ||
    securityEvents.error ||
    ownTeam.error ||
    memberships.error
  ) {
    return NextResponse.json(
      { error: "Export failed. Try again in a minute." },
      { status: 500 },
    );
  }

  const exportedAt = new Date();
  const payload = {
    exported_at: exportedAt.toISOString(),
    account: {
      id: user.id,
      email: user.email,
      created_at: user.created_at,
    },
    profile: profile.data,
    products: products.data,
    storefronts: storefronts.data,
    // What the seller agreed to pay us. The Stripe customer and subscription
    // ids stay out (system bookkeeping, as above); invoices are in the
    // Customer Portal, where Stripe keeps them.
    billing: {
      plan: billing.billing.plan,
      billing_interval: billing.billing.interval,
      status: billing.billing.status,
      price_cents: billing.billing.priceCents,
      currency: billing.billing.currency,
      current_period_end: billing.billing.currentPeriodEnd,
      cancel_at_period_end: billing.billing.cancelAtPeriodEnd,
      // A plan Square Share gave the account, while it applies.
      plan_grant: billing.billing.grant
        ? { plan: billing.billing.grant.plan, starts_at: billing.billing.grant.startsAt, ends_at: billing.billing.grant.endsAt }
        : null,
    },
    plan_cancellations: cancellations.data,
    orders: orders.data,
    notifications: notifications.data,
    security_events: securityEvents.data,
    team: { invited: ownTeam.data, member_of: memberships.data },
    // Which of the lists above stopped at the newest EXPORT_ROWS_MAX rows.
    truncated: {
      orders: (orders.data?.length ?? 0) >= EXPORT_ROWS_MAX,
      notifications: (notifications.data?.length ?? 0) >= EXPORT_ROWS_MAX,
      security_events: (securityEvents.data?.length ?? 0) >= EXPORT_ROWS_MAX,
    },
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="square-share-export-${exportedAt.toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
