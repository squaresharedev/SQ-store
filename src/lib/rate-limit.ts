import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CONTACT_CODE_COOLDOWN_SECONDS } from "@/lib/contact-verification/policy";

// SERVER ONLY. rateLimitKey uses the service-role admin client; this module must
// never be imported from a Client Component. (Enforced by convention here — the
// `server-only` package is not a dependency of this project.)

/**
 * Server-side rate limiting. Both helpers are backed by an EXACT SLIDING WINDOW
 * in Postgres (see supabase/migrations/20260721_sliding_window_rate_limits.sql),
 * so a caller cannot spend a full budget just before a boundary and another one
 * just after — every take counts the hits in the PRECEDING window, continuously.
 *
 * Postgres (not memory) is the right home for this on Cloudflare Workers: there
 * is no shared memory between isolates, so an in-process counter would reset on
 * every cold start and be trivially bypassed by spreading requests around.
 *
 * FAIL CLOSED. If the limiter itself errors we deny the action. These guard
 * spam and abuse surfaces; letting traffic through when the limiter is broken
 * defeats the point.
 */

/** Budgets in one place so limits are reviewable without grepping call sites. */
export const RATE_LIMITS = {
  /** Emails aimed at an ADDRESS (magic link, reset). Keyed on the target. */
  authEmailPerAddress: { max: 3, windowSeconds: 60 * 60 },
  /** All auth email sends from one client, regardless of target address. */
  authEmailPerClient: { max: 8, windowSeconds: 60 * 60 },
  /** Password attempts per client — brute-force brake, not a lockout. */
  authSignInPerClient: { max: 10, windowSeconds: 15 * 60 },
  /**
   * Resolving a sign-in HANDLE to an account email. Spent on top of the
   * sign-in budget, never instead of it, so probing handles can never buy a
   * caller extra password attempts.
   *
   * Same size as the sign-in budget on purpose: signing in by handle must not
   * be stingier than signing in by email for the person who simply mistyped.
   * What it adds is a second, independent brake on the one surface that could
   * otherwise answer "does this handle exist?" faster than a password attempt.
   */
  usernameResolvePerClient: { max: 10, windowSeconds: 15 * 60 },
  /** Account creation per client. */
  authSignUpPerClient: { max: 5, windowSeconds: 60 * 60 },
  /** Team invites sent by one user: the in-app "spam a stranger" vector. */
  teamInvite: { max: 20, windowSeconds: 60 * 60 },
  /**
   * Membership changes (role grants, access revocation). These edit who can do
   * what inside a store, so an automated loop against them is a privilege
   * problem, not just load. Well above any real team's churn.
   */
  teamMembership: { max: 60, windowSeconds: 60 * 60 },
  /** Upload URL minting — each one authorises bytes into R2. */
  uploadPresign: { max: 60, windowSeconds: 60 * 60 },
  /**
   * The hosted product page, per client IP. Two service-role reads and a few
   * HMAC signatures per hit; the budget is sized for a person browsing a
   * catalogue, not a crawler walking one. Fails closed like the embed routes.
   */
  productPage: { max: 600, windowSeconds: 60 * 60 },
  /**
   * The stable og-image redirect (api/og/p/[productId]): one service-role
   * lookup and one presign per hit. Social crawlers re-scrape cards repeatedly,
   * so the ceiling matches productPage; what it stops is a scanner walking
   * every product id on the platform to enumerate which are active.
   */
  ogImage: { max: 600, windowSeconds: 60 * 60 },
  /** The editor's product-page preview data, per signed-in user. */
  productPreview: { max: 300, windowSeconds: 60 * 60 },
  /**
   * Content reports from a buyer, per client IP. The only unauthenticated
   * WRITE in the app, so it is the tightest budget here.
   *
   * Ten an hour, which is generous for the honest case and useless for the
   * dishonest one. Reporting is rare: a person who has found something wrong
   * reports it once and leaves. The abuse this bounds is not volume for its
   * own sake, it is someone trying to manufacture the report count that
   * demotes a competitor, and the per-reporter dedupe index in the database is
   * the other half of that defence (one open report per reporter per target,
   * so ten calls cannot become ten reports on one listing).
   */
  contentReport: { max: 10, windowSeconds: 60 * 60 },
  /**
   * A seller appealing a moderation decision, per signed-in user. The
   * database already allows one appeal per decision, so this does not bound
   * appeals; it bounds a loop hammering the action (each call is two reads
   * and an insert attempt) and the staff pings that follow.
   */
  moderationAppeal: { max: 10, windowSeconds: 60 * 60 },
  /**
   * Downloading a statement of reasons, per signed-in user. A read, but each
   * one lays out and serialises a PDF, which is real CPU on a Worker. Far
   * above anyone saving their own decisions; a loop regenerating one on
   * repeat is what it stops.
   */
  moderationStatement: { max: 60, windowSeconds: 60 * 60 },
  /**
   * Digital-file uploads specifically, which are capped at 200 MB EACH — an
   * order of magnitude larger than an image.
   *
   * Split out of uploadPresign because a per-request budget prices every call
   * the same, and these are not the same: 60 image uploads is a busy afternoon,
   * 60 file uploads is 12 GB. The limiter counts events and cannot weigh them
   * by size (rate_limits stores bare timestamps), so the cheap way to bound
   * bytes is to bound the calls that carry the most.
   *
   * Sized for the real workload: a seller attaches one file per digital
   * product, so a dozen an hour is already an unusual amount of publishing.
   * This bounds storage abuse, not orphan cleanup — an object uploaded and
   * never attached to a product is still unreferenced, which is what the R2
   * lifecycle rule is for.
   */
  fileUpload: { max: 12, windowSeconds: 60 * 60 },
  /**
   * Product DOCUMENT uploads (manuals, certificates, spec sheets): PDF only,
   * 20 MB each, so the byte ceiling here is 600 MB an hour per seller.
   *
   * Split from fileUpload in both directions. Documents are attached in
   * batches: a product may carry DOCUMENTS_MAX of them, and a seller listing
   * two regulated products in one sitting would otherwise exhaust the
   * twelve-call digital-file budget and be locked out of the upload their
   * PRODUCT needs. And going the other way, a document is a public,
   * unauthenticated download once saved, so it should never be able to spend
   * the budget that guards the paid one.
   *
   * 30 is a shade under four full products' worth an hour: comfortably past
   * any real afternoon of listing, and nowhere near enough to matter as a
   * storage or egress vector.
   */
  documentUpload: { max: 30, windowSeconds: 60 * 60 },
  /** Handle probing from the settings field. An enumeration brake, and the
   *  handle is half a credential, so the answer is worth something to an
   *  attacker even though the field is public. */
  usernameCheck: { max: 60, windowSeconds: 60 * 60 },
  /**
   * Public embed reads, keyed on the requesting CLIENT (no session exists).
   * Generous, because one page view can legitimately be one request and a
   * popular embedding site shares an egress IP — this is a scraping and cost
   * brake, not an access control. The origin allowlist is the access control.
   */
  embedFetch: { max: 600, windowSeconds: 60 * 60 },
  /**
   * Analytics signals reported by the embed widget, keyed on the CLIENT.
   *
   * Its own budget rather than sharing embedFetch's, in both directions: a
   * visitor clicking around one storefront legitimately sends several of these
   * per payload fetch, so sharing would let interaction lock out rendering;
   * and this one causes a WRITE, so it should never be spendable by a read.
   *
   * Sized as a rough ceiling on real interaction (a click every couple of
   * seconds, sustained for an hour) rather than on abuse: the row that lands
   * is already deduped, origin-gated and limited to one non-conversion kind,
   * so what this bounds is database writes, not the honesty of the figure.
   */
  embedSignal: { max: 1200, windowSeconds: 60 * 60 },
  /** Avatar uploads (pre-existing budget, unchanged). */
  avatarUpload: { max: 5, windowSeconds: 60 * 60 },
  /**
   * Universal search. A READ budget, and the only one spent per keystroke, so
   * it is the loosest here by design: the palette debounces to roughly one
   * request per 300ms of typing, which a determined session of searching can
   * legitimately sustain for a while. What it stops is a script walking the
   * catalogue through the one endpoint that returns rows from five tables at
   * once. Every query is still account-scoped and capped at a handful of rows,
   * so the ceiling is about DB load, not disclosure.
   */
  searchQuery: { max: 600, windowSeconds: 60 * 60 },
  /**
   * The search SNAPSHOT: one compact per-account index fetch, warmed shortly
   * after the shell mounts and refreshed on a 60s client TTL. Remounts (route
   *-group hops, account switches) each spend one; 120/hour clears any human
   * pattern while staying 5x tighter than the per-keystroke budget above.
   */
  searchSnapshot: { max: 600, windowSeconds: 60 * 60 },
  /**
   * The storefront designer's PRODUCT PICKER search — also per-keystroke (250ms
   * debounce), but on its own budget rather than sharing searchQuery, because
   * the two calls do not cost the same. This one returns a 50-row product page,
   * and every returned row costs an R2 presign (an HMAC each), so a call here
   * is materially heavier than the handful of capped rows /api/search answers
   * with. Half the universal-search budget: still far above anyone actually
   * building a storefront, and it bounds the presign work a scripted loop can
   * drive through a read that has no other brake on it.
   */
  pickerSearch: { max: 300, windowSeconds: 60 * 60 },

  // --- Signed-in write budgets ------------------------------------------
  // These sit on top of RLS and role checks, which already decide WHETHER a
  // caller may write. What they bound is VOLUME: a compromised session or a
  // runaway client can otherwise drive unbounded DB writes and R2 traffic
  // inside its own account. Set well above real human use, so they only ever
  // catch automation.

  /**
   * Email-change requests. The lowest budget here by a wide margin because it
   * is the only signed-in action that sends mail to an address the CALLER
   * supplies — i.e. it can be aimed at a stranger's inbox.
   */
  emailChange: { max: 5, windowSeconds: 60 * 60 },
  /** Reset mail to the account's OWN address; still mail, so still bounded. */
  passwordReset: { max: 5, windowSeconds: 60 * 60 },
  /**
   * The same reset mail, bounded a second time on the CLIENT rather than the
   * user. Not redundant: the per-user budget above is spent by whoever holds a
   * session, so someone working through several compromised sessions gets a
   * fresh 5 per victim. This one caps what a single origin can send in total,
   * so the inbox-flooding cost does not scale with the number of accounts an
   * attacker has reached. Mirrors the pair on the signed-out mail path
   * (authEmailPerAddress + authEmailPerClient).
   */
  passwordResetPerClient: { max: 5, windowSeconds: 60 * 60 },
  /**
   * Re-authentication attempts from inside a session (password change, email
   * change). These VERIFY a caller-supplied password, so an unbounded version
   * is a password oracle a hijacked session could grind against. Tighter than
   * the sign-in budget because a legitimate user knows their own password.
   */
  passwordReauth: { max: 10, windowSeconds: 15 * 60 },
  /** Product create/update/delete: each can head or evict an R2 object. */
  productWrite: { max: 120, windowSeconds: 60 * 60 },
  /**
   * CSV product imports. Its own budget rather than productWrite's, because
   * the two are not the same size: one call here parses a file and inserts up
   * to IMPORT_ROWS_MAX rows in a batch, so pricing it as a single product
   * write would let a script drive thousands of inserts through the cheapest
   * budget in this list.
   *
   * Deliberately small. Moving a catalogue is something a seller does once,
   * then a few more times while they get the columns right; anything past a
   * dozen attempts in an hour is a loop, not a person.
   */
  productImport: { max: 12, windowSeconds: 60 * 60 },
  /** Storefront saves: the heaviest write path (multi-query + R2 verify). */
  storefrontWrite: { max: 240, windowSeconds: 60 * 60 },
  /**
   * Reading one storefront's product page settings
   * (api/storefronts/[id]/product-page). A single indexed row, so the ceiling
   * is about a loop rather than about load; its WRITE spends storefrontWrite,
   * since it touches the same column by the same rules as a designer save.
   *
   * Budgeted on its own because this is the first route shaped for something
   * other than a browser to call (see the route's own header), and a caller
   * polling it must not be able to spend the seller's search budget.
   */
  productPageRead: { max: 600, windowSeconds: 60 * 60 },
  /** Stock edits: a single UPDATE, but trivially scriptable. */
  stockWrite: { max: 240, windowSeconds: 60 * 60 },
  /**
   * Marking orders shipped (or changing a tracking number). Each one can mail
   * a BUYER, so it is bounded even though the database lets each order be
   * shipped only once: a tracking number can be changed over and over. Sized
   * for a seller clearing a busy day's queue in one sitting.
   */
  orderFulfil: { max: 240, windowSeconds: 60 * 60 },
  /** Profile / tax / notification-preference writes. */
  settingsWrite: { max: 60, windowSeconds: 60 * 60 },
  // --- Plans & billing (lib/billing) ---------------------------------------
  /**
   * Opening Stripe Checkout or the Customer Portal. Each one is a call to
   * Stripe on the platform's key (and may create a customer there), so a
   * stuck or scripted client must not be able to spin them without end. A
   * real owner opens a handful in an afternoon.
   */
  billingWrite: { max: 20, windowSeconds: 60 * 60 },
  /** Confirming a Stripe Checkout return (one read from Stripe), per user. */
  billingRead: { max: 300, windowSeconds: 60 * 60 },
  /**
   * Not a budget: at most one "pricing viewed" funnel row per account and
   * entry point in this window, so a seller reloading the plans page counts
   * once.
   */
  pricingViewDedupe: { max: 1, windowSeconds: 10 * 60 },
  /**
   * The orders CSV (app/api/orders/export). Reads up to ten thousand orders
   * in pages and builds a file from them, so it is the heaviest read a seller
   * can start from a button. Bookkeeping needs it a few times a month; this
   * leaves room for retries and bites only a loop.
   */
  ordersExport: { max: 20, windowSeconds: 60 * 60 },
  // --- Contact verification ----------------------------------------------
  // A code emailed or texted to the seller's buyer-facing contact details
  // (lib/contact-verification). Sending is the expensive and abusable half:
  // it puts a message in a stranger's inbox or phone if the seller typed
  // theirs, and a text costs money (SMS pumping is a real fraud). So every send
  // spends FIVE budgets, each closing a different hole, before anything goes out.

  /** One code per channel per minute: a double-click is not two texts. */
  contactCodeCooldown: { max: 1, windowSeconds: CONTACT_CODE_COOLDOWN_SECONDS },
  /** Codes one account can ask for in an hour, both channels together. */
  contactCodeSend: { max: 6, windowSeconds: 60 * 60 },
  /** And in a day, so waiting out the hour cannot be scripted into a stream. */
  contactCodeSendDaily: { max: 12, windowSeconds: 24 * 60 * 60 },
  /**
   * Codes one ADDRESS or NUMBER can receive in a day, across every account.
   * The per-account budgets reset with each new sign-up; this one does not, so
   * nobody can flood a stranger's inbox or phone by opening accounts, and the
   * guesses anyone can ever buy against one target stay bounded
   * (5 codes x CONTACT_CODE_MAX_ATTEMPTS a day against a 10^8 space).
   */
  contactCodePerTarget: { max: 5, windowSeconds: 24 * 60 * 60 },
  /** Codes from one client, across every account it signs in to. */
  contactCodePerClient: { max: 20, windowSeconds: 60 * 60 },
  /**
   * Every text the platform sends in a day. A cost ceiling, not an access
   * control: if something gets past all of the above, the bill still stops
   * here. Sized far above what real sellers confirming a number need.
   */
  contactSmsPlatformDaily: { max: 2000, windowSeconds: 24 * 60 * 60 },
  /**
   * Code checks per account, across codes. Each code already dies after
   * CONTACT_CODE_MAX_ATTEMPTS wrong tries (counted in the database); this
   * bounds the loop of "send, guess five, send again" in wall-clock time.
   */
  contactCodeVerify: { max: 20, windowSeconds: 60 * 60 },
  /**
   * GDPR data export. Reads the caller's ENTIRE account (profile + every
   * product + every storefront config) in three parallel queries and streams
   * it back as a file. A human exports rarely; anything faster than this is a
   * scripted loop hammering the most expensive read in the app.
   */
  dataExport: { max: 5, windowSeconds: 60 * 60 },

  // --- Two-factor authentication ------------------------------------------
  // Every budget below is keyed on the ACCOUNT (plus one on the client), and
  // is only reachable by a session that has already passed the password or
  // Google step. So nobody can burn a stranger's budget to lock them out
  // without first holding their password, and anyone who does hold it has
  // bigger news coming: the lockout itself emails the owner.

  /**
   * Second-factor attempts (authenticator codes AND recovery codes, one shared
   * budget) per account, short window. A six-digit code checked with GoTrue's
   * one-step skew accepts 3 of 10^6 values, so each guess is a 3-in-a-million
   * shot; six per ten minutes lets a person fumble twice and still get in.
   */
  mfaVerifyPerUser: { max: 6, windowSeconds: 10 * 60 },
  /**
   * The same attempts over a day, so waiting out the short window cannot be
   * scripted into a steady grind: 30 guesses a day is roughly a 1-in-10,000
   * chance per day for someone who already has the password, and the lockout
   * alert tells the owner to change that password long before it adds up.
   */
  mfaVerifyPerUserDaily: { max: 30, windowSeconds: 24 * 60 * 60 },
  /** All second-factor attempts from one client, across every account. Caps an
   *  attacker working through many stolen passwords from one address. */
  mfaVerifyPerClient: { max: 30, windowSeconds: 15 * 60 },
  /**
   * The replay guard, not a budget: a key per (account, code) that may be taken
   * ONCE per window. GoTrue accepts a code for about 90 seconds and does not
   * remember having accepted it, so without this a code read over someone's
   * shoulder stays usable after its owner has already typed it. Three minutes
   * outlives the whole acceptance window.
   */
  mfaCodeReplay: { max: 1, windowSeconds: 3 * 60 },
  /** At most one "someone is guessing your 2FA codes" alert per account per
   *  hour, however long the guessing goes on. */
  mfaLockoutAlert: { max: 1, windowSeconds: 60 * 60 },
  /** Starting 2FA setup (each start creates a pending factor at GoTrue). */
  mfaEnroll: { max: 10, windowSeconds: 60 * 60 },
  /** Removing authenticators and regenerating recovery codes. */
  mfaManage: { max: 20, windowSeconds: 60 * 60 },
  /**
   * Not a budget: each passkey challenge may be verified ONCE. Its slip cookie
   * is deleted as it is read, and this remembers the challenge for longer than
   * the slip lives, so even a replayed request carrying the old cookie fails.
   */
  webauthnChallenge: { max: 1, windowSeconds: 10 * 60 },
  /**
   * Sign-in approval QR codes one account can ask for (lib/auth/
   * sign-in-approval.ts). Only a session that already passed the password can
   * ask, so this bounds rows and the phone-side noise, not guessing: each
   * request is a 256-bit token nobody types. Ten per quarter hour covers a
   * person letting a few codes expire while they hunt for their phone.
   */
  mfaApprovalStart: { max: 10, windowSeconds: 15 * 60 },
  /** The same, from one client across every account it signs in to. */
  mfaApprovalStartPerClient: { max: 30, windowSeconds: 15 * 60 },
  /** Approve or deny taps by one signed-in account. */
  mfaApprovalDecide: { max: 30, windowSeconds: 60 * 60 },
  /**
   * Not a budget: at most one "a sign-in was refused" alert per account per
   * quarter hour. Someone holding the password can start ten requests in that
   * time; each refusal is logged, but the owner gets one message, not ten.
   */
  mfaApprovalDenyAlert: { max: 1, windowSeconds: 15 * 60 },
  /**
   * Views of a hosted checkout, per client IP. The same ceiling as the product
   * page it is reached from: a buyer comparing versions reloads it a few times,
   * a scanner walking ids pays like one.
   */
  checkoutPage: { max: 600, windowSeconds: 60 * 60 },
  /**
   * Placing an order, per client IP. The one public write that starts a
   * payment, so it is where card testing would aim: twenty an hour is several
   * honest retries after a declined card, and nothing like a script's pace.
   */
  checkoutPlace: { max: 20, windowSeconds: 60 * 60 },
  /** Opens of an order page (the thank-you and order status), per client IP. */
  orderPage: { max: 240, windowSeconds: 60 * 60 },
  /** Download links handed out from order pages, per client IP. */
  orderDownload: { max: 60, windowSeconds: 60 * 60 },
  /** Withdrawal requests, per client IP. Each one is a real email to a seller. */
  orderWithdraw: { max: 10, windowSeconds: 60 * 60 },
  /**
   * Withdrawal attempts against ONE order, whoever they come from. The buyer's
   * email is the second factor on the withdrawal form, and a per-IP budget
   * alone lets a crowd of addresses guess at it in parallel; this bounds the
   * guessing per order however many IPs it arrives from.
   */
  orderWithdrawPerOrder: { max: 8, windowSeconds: 60 * 60 },
  /**
   * "Email me my order link" lookups, per client IP. Each can send mail, and
   * an address is not proof of anything, so this stays small.
   */
  orderLookup: { max: 5, windowSeconds: 60 * 60 },
} as const;

export type RateLimitBudget = { max: number; windowSeconds: number };

/**
 * Hash before storing. Rate-limit keys are emails and IP addresses; hashing
 * keeps the limiter from quietly becoming a log of who tried to sign in from
 * where. Sliding-window state only needs equality, so a digest is sufficient.
 *
 * Not a password hash and not trying to be: the point is to avoid persisting
 * plaintext identifiers, not to resist offline cracking of a known-small space.
 */
async function hashKey(raw: string): Promise<string> {
  const bytes = new TextEncoder().encode(raw.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Take from the SIGNED-IN user's budget for `action`. Identity comes from
 * auth.uid() inside Postgres — never from an argument — so one user can neither
 * spend nor inspect another's budget.
 *
 * Returns true when the action may proceed.
 */
export async function rateLimit(
  action: string,
  budget: RateLimitBudget,
): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("rl_take", {
      p_action: action,
      p_max: budget.max,
      p_window_seconds: budget.windowSeconds,
    });
    if (error) {
      console.warn(`[rate-limit] ${action} check failed:`, error.message);
      return false; // fail closed
    }
    return data === true;
  } catch (err) {
    console.warn(
      `[rate-limit] ${action} threw:`,
      err instanceof Error ? err.message : String(err),
    );
    return false; // fail closed
  }
}

/**
 * Take from a budget keyed on an arbitrary identifier, for surfaces with no
 * session yet (sending a magic link, a reset email, signing up).
 *
 * `rawKey` is hashed here and the RPC is service_role-only, so a client can
 * never call it directly with a key of its own choosing — which would make the
 * limit meaningless.
 */
export async function rateLimitKey(
  rawKey: string,
  action: string,
  budget: RateLimitBudget,
): Promise<boolean> {
  if (!rawKey) return false;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("rl_take_key", {
      p_key: await hashKey(rawKey),
      p_action: action,
      p_max: budget.max,
      p_window_seconds: budget.windowSeconds,
    });
    if (error) {
      console.warn(`[rate-limit] ${action} (keyed) check failed:`, error.message);
      return false; // fail closed
    }
    return data === true;
  } catch (err) {
    console.warn(
      `[rate-limit] ${action} (keyed) threw:`,
      err instanceof Error ? err.message : String(err),
    );
    return false; // fail closed
  }
}

/**
 * Best-effort client identity for anonymous limits.
 *
 * On Cloudflare, CF-Connecting-IP is set by the edge and cannot be spoofed by
 * the client. The x-forwarded-for fallback is only for local dev — a client CAN
 * forge that header, so anonymous limits are defence-in-depth (paired with a
 * per-target-address limit that no header can influence), never the sole guard.
 */
export async function clientKey(headerList: Headers): Promise<string> {
  return (
    headerList.get("cf-connecting-ip") ??
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown-client"
  );
}
