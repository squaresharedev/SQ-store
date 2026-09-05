// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * SECURITY INVARIANTS for server actions.
 *
 * Server actions are public HTTP endpoints — anything exported from a
 * `"use server"` module can be invoked by anyone with a session, regardless of
 * which component happens to call it. Several real holes in this codebase were
 * of exactly that shape: a mutating action that nobody had thought to bound,
 * and a password check with no limit in front of it.
 *
 * So rather than trusting review to notice, every action is CLASSIFIED here.
 * A new action fails this suite until someone states what it is, which forces
 * the decision to be made and recorded rather than defaulted.
 *
 * Adding an entry is not a rubber stamp: `unlimited` requires a reason, and
 * the reason is the thing a reviewer reads.
 */

type Classification =
  /** Mutates state and must take from a rate-limit budget. */
  | { kind: "limited" }
  /** Mutates, but deliberately unbounded. Requires a stated reason. */
  | { kind: "unlimited"; reason: string }
  /** Pure read, or navigation/session teardown. No budget needed. */
  | { kind: "read" };

const limited = (): Classification => ({ kind: "limited" });
const unlimited = (reason: string): Classification => ({ kind: "unlimited", reason });
const read = (): Classification => ({ kind: "read" });

/** Every exported server action, by `module::export`. */
const REGISTRY: Record<string, Classification> = {
  // --- auth ---------------------------------------------------------------
  "lib/auth/actions.ts::authenticate": limited(),
  "lib/auth/actions.ts::resetPassword": unlimited(
    "Reachable only with a valid recovery session, which already proves control of the inbox; the link itself is the scarce resource and Supabase expires it.",
  ),
  "lib/auth/actions.ts::signInWithGoogle": read(),
  "lib/auth/actions.ts::signOut": read(),
  "lib/auth/actions.ts::signOutEverywhere": read(),

  // --- settings -----------------------------------------------------------
  "lib/settings/actions.ts::updateUsername": limited(),
  "lib/settings/actions.ts::requestEmailChange": limited(),
  "lib/settings/actions.ts::changePassword": limited(),
  "lib/settings/actions.ts::sendPasswordReset": limited(),
  "lib/settings/actions.ts::saveTaxInfo": limited(),
  // Its own module because it writes a jsonb document rather than columns, but
  // the same budget as every other settings write: a signed-in seller editing
  // their own row.
  "lib/settings/shipping-actions.ts::saveShippingPolicy": limited(),
  "lib/settings/actions.ts::saveNotifications": limited(),
  "lib/settings/actions.ts::requestAccountDeletion": limited(),
  "lib/settings/actions.ts::cancelAccountDeletion": unlimited(
    "Undoes a pending deletion. Bounding the ESCAPE from a destructive state is the wrong way round; the request side is what is limited.",
  ),
  "lib/settings/actions.ts::acceptLegal": unlimited(
    "Idempotent write of a fixed version constant. Repeating it changes nothing and costs one indexed update.",
  ),
  "lib/settings/avatar.ts::uploadAvatar": limited(),
  "lib/settings/avatar.ts::removeAvatar": limited(),

  // --- products / stock / storefront --------------------------------------
  "lib/products/actions.ts::createProduct": limited(),
  "lib/products/actions.ts::updateProduct": limited(),
  "lib/products/actions.ts::deleteProduct": limited(),
  // Its own budget, not productWrite's: one call parses a file and inserts up
  // to IMPORT_ROWS_MAX rows, so pricing it as a single product write would let
  // a script drive thousands of inserts through the cheapest budget there is.
  "lib/products/import-actions.ts::importProducts": limited(),
  "lib/stock/actions.ts::updateStockSettings": limited(),
  "lib/storefront/actions.ts::createStorefront": limited(),
  "lib/storefront/actions.ts::saveStorefront": limited(),
  "lib/storefront/actions.ts::updateEmbedSettings": limited(),
  "lib/storefront/actions.ts::deleteStorefront": limited(),
  "lib/storefront/actions.ts::rotateEmbedKey": limited(),

  // --- team ---------------------------------------------------------------
  "lib/team/actions.ts::inviteMember": limited(),
  "lib/team/actions.ts::changeMemberRole": limited(),
  "lib/team/actions.ts::revokeMemberAccess": limited(),
  "lib/team/actions.ts::acceptInvite": unlimited(
    "Consumes an invite the caller was already sent; the invite row is the scarce resource, and inviteMember is what bounds their creation.",
  ),
  "lib/team/actions.ts::setActiveAccount": unlimited(
    "Writes one cookie after checking membership. No DB write, nothing to exhaust.",
  ),

  // --- notifications ------------------------------------------------------
  // Roster paging: self-gated team_roster RPC read, offset clamped; the page
  // seeds 50 rows and this fetches the rest on demand.
  "lib/team/actions.ts::fetchTeamRosterPage": read(),

  // Storefront list paging: account-scoped read via listStorefronts, offset
  // clamped; the list seeds one bounded page and this fetches the rest.
  "lib/storefront/actions.ts::fetchStorefrontsPage": read(),

  // --- products ------------------------------------------------------------
  // Picker search: a read, but a bounded one. listProducts enforces the
  // active-account boundary and ILIKE-escapes the term, so the risk is not
  // access — it is cost. Each call presigns up to 50 R2 objects, and a server
  // action is callable in a loop by any session, so it takes from a budget.
  "lib/products/picker-actions.ts::searchCatalogProducts": limited(),
  // The editor's product-page preview: active-account scoped read, store.read,
  // rate limited, returns the same buyer-safe shape as the public route.
  "lib/products/preview-actions.ts::getProductPagePreviewData": limited(),

  "lib/notifications/actions.ts::fetchNotificationSnapshot": read(),
  "lib/notifications/actions.ts::fetchUnreadCount": read(),
  "lib/notifications/actions.ts::fetchNotificationPage": read(),
  "lib/notifications/actions.ts::getRealtimeToken": read(),
  "lib/notifications/actions.ts::markNotificationRead": unlimited(
    "Fires once per notification a user clicks; a budget here would break ordinary reading. One indexed update, scoped to the caller's own row.",
  ),
  "lib/notifications/actions.ts::markAllNotificationsRead": unlimited(
    "Same path as markNotificationRead, one statement instead of many.",
  ),
};

const SRC = join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function relative(file: string): string {
  return file.slice(SRC.length + 1).replace(/\\/g, "/");
}

/** Split a module into its exported async functions and their bodies. */
function actionsIn(source: string): { name: string; body: string }[] {
  const found: { name: string; body: string }[] = [];
  const re = /^export async function (\w+)\s*\(/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const start = m.index;
    // Body runs to the next top-level export, or the end of the file.
    const nextExport = source.slice(start + m[0].length).search(/^export /m);
    const end =
      nextExport === -1 ? source.length : start + m[0].length + nextExport;
    found.push({ name: m[1], body: source.slice(start, end) });
  }
  return found;
}

/** Every `"use server"` module, with its actions. */
function serverActions(): { key: string; body: string }[] {
  const out: { key: string; body: string }[] = [];
  for (const file of walk(SRC)) {
    const source = readFileSync(file, "utf8");
    if (!/^["']use server["']/m.test(source)) continue;
    for (const { name, body } of actionsIn(source)) {
      out.push({ key: `${relative(file)}::${name}`, body });
    }
  }
  return out;
}

const ACTIONS = serverActions();

/** Does this body take from a rate-limit budget? */
function isRateLimited(body: string): boolean {
  return /\brateLimit(?:Key)?\s*\(/.test(body);
}

describe("server action registry", () => {
  it("discovers the action surface (guards against a broken parser)", () => {
    expect(ACTIONS.length).toBeGreaterThan(20);
  });

  it("every server action is classified", () => {
    // A new action lands here until someone decides what it is. That decision
    // is the whole point: the holes this suite exists for were all "nobody
    // considered it", never "we decided not to".
    const unclassified = ACTIONS.map((a) => a.key).filter((key) => !(key in REGISTRY));
    expect(unclassified).toEqual([]);
  });

  it("has no stale registry entries", () => {
    // Otherwise a deleted action leaves a rule that silently protects nothing.
    const live = new Set(ACTIONS.map((a) => a.key));
    expect(Object.keys(REGISTRY).filter((key) => !live.has(key))).toEqual([]);
  });

  it("every action classified 'limited' actually takes from a budget", () => {
    const missing = ACTIONS.filter(
      ({ key, body }) => REGISTRY[key]?.kind === "limited" && !isRateLimited(body),
    ).map((a) => a.key);
    expect(missing).toEqual([]);
  });

  it("every 'unlimited' classification carries a real reason", () => {
    const weak = Object.entries(REGISTRY)
      .filter(([, c]) => c.kind === "unlimited")
      .filter(([, c]) => (c as { reason: string }).reason.trim().length < 40)
      .map(([key]) => key);
    expect(weak).toEqual([]);
  });
});

describe("credential-change invariants", () => {
  /** Actions that write a new password. */
  // `[\s\S]` rather than the `s` flag: the tsconfig target predates it.
  const passwordWrites = ACTIONS.filter(({ body }) =>
    /updateUser\s*\(\s*\{[^}]*\bpassword\b/.test(body.replace(/\r?\n/g, " ")),
  );

  it("finds the password-writing actions", () => {
    expect(passwordWrites.map((a) => a.key).sort()).toEqual([
      "lib/auth/actions.ts::resetPassword",
      "lib/settings/actions.ts::changePassword",
    ]);
  });

  it("every password change revokes the other sessions", () => {
    // A password changed BECAUSE an account was compromised is worthless if
    // the intruder's existing session survives it.
    const missing = passwordWrites
      .filter(({ body }) => !/revokeOtherSessions\s*\(/.test(body))
      .map((a) => a.key);
    expect(missing).toEqual([]);
  });

  it("revocation always keeps the current session ('others', never 'global')", () => {
    // 'global' would sign the user out of the tab they are standing in,
    // turning a security improvement into a bug report.
    const source = readFileSync(join(SRC, "lib/auth/session.ts"), "utf8");
    expect(source).toMatch(/scope:\s*["']others["']/);
    expect(source).not.toMatch(/revokeOtherSessions[\s\S]*scope:\s*["']global["']/);
  });
});

describe("re-authentication invariants", () => {
  /**
   * Actions that verify a caller-supplied password. Each is a password ORACLE
   * and must be bounded, or a hijacked session can grind against it.
   */
  const reauthing = ACTIONS.filter(({ body }) =>
    /signInWithPassword\s*\(/.test(body),
  );

  it("finds every action that verifies a password", () => {
    // Sign-in belongs here too: it is the original password oracle, and is
    // bounded by the per-client sign-in budget.
    expect(reauthing.map((a) => a.key).sort()).toEqual([
      "lib/auth/actions.ts::authenticate",
      "lib/settings/actions.ts::changePassword",
      "lib/settings/actions.ts::requestEmailChange",
    ]);
  });

  it("every password check is rate limited", () => {
    const missing = reauthing
      .filter(({ body }) => !isRateLimited(body))
      .map((a) => a.key);
    expect(missing).toEqual([]);
  });

  it("takeover-grade actions re-authenticate", () => {
    // Changing the account email is takeover-grade: whoever controls the
    // address can reset the password to it. An open session must not suffice.
    const emailChange = ACTIONS.find(
      (a) => a.key === "lib/settings/actions.ts::requestEmailChange",
    );
    expect(emailChange?.body).toMatch(/signInWithPassword/);
  });
});

describe("rate-limit budget hygiene", () => {
  const limiter = readFileSync(join(SRC, "lib/rate-limit.ts"), "utf8");

  it("fails CLOSED on limiter errors", () => {
    // A limiter that lets traffic through when it breaks is not a limiter.
    // Both helpers must return false on both the error and the throw path.
    const returns = limiter.match(/return false; \/\/ fail closed/g) ?? [];
    expect(returns.length).toBeGreaterThanOrEqual(4);
  });

  it("never takes the caller's identity from an argument", () => {
    // rl_take derives identity from auth.uid() inside Postgres; a p_user_id
    // parameter would let one caller spend another's budget.
    expect(limiter).not.toMatch(/p_user_id/);
  });

  it("hashes keyed identifiers rather than storing them", () => {
    expect(limiter).toMatch(/hashKey\(/);
    expect(limiter).toMatch(/SHA-256/);
  });

  it("declares every budget it is asked for", () => {
    // Catches a typo'd budget name resolving to undefined, which would make
    // max/window undefined and the limit meaningless.
    const declared = new Set(
      Array.from(limiter.matchAll(/^\s{2}(\w+):\s*\{\s*max:/gm), (m) => m[1]),
    );
    const used = new Set(
      ACTIONS.flatMap(({ body }) =>
        Array.from(body.matchAll(/RATE_LIMITS\.(\w+)/g), (m) => m[1]),
      ),
    );
    expect([...used].filter((name) => !declared.has(name))).toEqual([]);
  });
});
