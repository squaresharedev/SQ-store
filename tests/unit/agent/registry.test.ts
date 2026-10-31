// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const { AGENT_TOOLS, findTool } = await import("@/lib/agent/tools");
const { AGENT_SCOPES } = await import("@/lib/agent/scopes");
const { toolAvailable } = await import("@/lib/agent/dispatch");
const { TEAM_ACTIONS, can } = await import("@/lib/team/permissions");

/**
 * THE AGENT SURFACE'S COVERAGE. Every server action has to say what it is to an
 * assistant, so a new action cannot quietly be left out, or quietly be exposed.
 * A new action fails this suite until someone has decided.
 *
 *   tool      reached through this tool
 *   person    never through an assistant: the reason is the point
 *   browser   about one browser, meaningless without it
 *   deferred  should come, not yet: the reason says why
 */
type Coverage =
  | { kind: "tool"; name: string }
  | { kind: "person"; reason: string }
  | { kind: "browser"; reason: string }
  | { kind: "deferred"; reason: string };

const tool = (name: string): Coverage => ({ kind: "tool", name });
const person = (reason: string): Coverage => ({ kind: "person", reason });
const browser = (reason: string): Coverage => ({ kind: "browser", reason });

const SIGN_IN = "Proving who you are is the person's own act, in their own session.";
const SECOND_FACTOR = "A second factor is what an assistant must not be able to stand in for.";
const STEP_UP = "Behind the 2FA step-up gate. A long-lived agent token must not be stronger than a stolen session.";
const MONEY = "A contract the owner pays for. Link them to the page instead.";
const PROOF = "The code proves the PERSON reads that inbox or phone. Never relayed through an assistant.";

const COVERAGE: Record<string, Coverage> = {
  // --- the agent surface itself ---------------------------------------------
  "lib/agent/consent-actions.ts::approveAgentConnection": person("An assistant must not be able to approve itself."),
  "lib/agent/consent-actions.ts::revokeConnectedApp": person("Taking access away is the person's call, from their own session."),

  // --- sign-in and security -------------------------------------------------
  "lib/auth/actions.ts::authenticate": person(SIGN_IN),
  "lib/auth/actions.ts::resetPassword": person(SIGN_IN),
  "lib/auth/actions.ts::signInWithGoogle": person(SIGN_IN),
  "lib/auth/actions.ts::signOut": browser("Ends one browser's session."),
  "lib/auth/actions.ts::signOutEverywhere": person("The compromise escape hatch. It also revokes every assistant."),
  "lib/auth/mfa-actions.ts::verifyTwoFactorSignIn": person(SECOND_FACTOR),
  "lib/auth/mfa-actions.ts::signInWithRecoveryCode": person(SECOND_FACTOR),
  "lib/auth/mfa-actions.ts::beginTwoFactorSetup": person(SECOND_FACTOR),
  "lib/auth/mfa-actions.ts::confirmTwoFactorSetup": person(SECOND_FACTOR),
  "lib/auth/mfa-actions.ts::signOutToReauthenticate": person(SECOND_FACTOR),
  "lib/auth/mfa-actions.ts::cancelTwoFactorSetup": person(SECOND_FACTOR),
  "lib/auth/mfa-actions.ts::beginPasskeySetup": person(SECOND_FACTOR),
  "lib/auth/mfa-actions.ts::confirmPasskeySetup": person(SECOND_FACTOR),
  "lib/auth/mfa-actions.ts::beginPasskeyHere": person(SECOND_FACTOR),
  "lib/auth/mfa-actions.ts::confirmPasskeyHere": person(SECOND_FACTOR),
  "lib/auth/mfa-actions.ts::passkeySignInOptions": person(SECOND_FACTOR),
  "lib/auth/mfa-actions.ts::passkeyStepUpOptions": person(SECOND_FACTOR),
  "lib/auth/mfa-actions.ts::verifyPasskeySignIn": person(SECOND_FACTOR),
  "lib/auth/mfa-actions.ts::removeAuthenticator": person(SECOND_FACTOR),
  "lib/auth/mfa-actions.ts::regenerateRecoveryCodes": person(SECOND_FACTOR),
  "lib/auth/mfa-actions.ts::confirmIdentity": person(SECOND_FACTOR),
  "lib/auth/sign-in-approval-actions.ts::startSignInApproval": person(SECOND_FACTOR),
  "lib/auth/sign-in-approval-actions.ts::checkSignInApproval": person(SECOND_FACTOR),
  "lib/auth/sign-in-approval-actions.ts::cancelSignInApproval": person(SECOND_FACTOR),
  "lib/auth/sign-in-approval-actions.ts::decideSignInApproval": person(SECOND_FACTOR),
  "lib/auth/sign-in-approval-actions.ts::reconfirmToApprove": person(SECOND_FACTOR),
  "lib/auth/sign-in-approval-actions.ts::setSignInApproval": person(SECOND_FACTOR),

  // --- account --------------------------------------------------------------
  "lib/settings/actions.ts::updateUsername": tool("update_username"),
  "lib/settings/actions.ts::updateBio": tool("update_bio"),
  "lib/settings/actions.ts::saveNotifications": tool("save_notification_settings"),
  "lib/settings/actions.ts::requestEmailChange": person(STEP_UP),
  "lib/settings/actions.ts::sendPasswordReset": person(SIGN_IN),
  "lib/settings/actions.ts::acceptLegal": person("Accepting terms binds the person: a decision, not an operation."),
  "lib/settings/actions.ts::saveTaxInfo": person(STEP_UP),
  "lib/settings/actions.ts::requestAccountDeletion": person(STEP_UP),
  "lib/settings/actions.ts::cancelAccountDeletion": person("Its grants are gone by then, and it is theirs to reverse."),
  "lib/settings/avatar.ts::uploadAvatar": tool("set_avatar"),
  "lib/settings/avatar.ts::removeAvatar": tool("remove_avatar"),
  "lib/settings/shipping-actions.ts::saveShippingPolicy": tool("save_shipping_policy"),
  "lib/contact-verification/actions.ts::sendContactCode": person(PROOF),
  "lib/contact-verification/actions.ts::confirmContactCode": person(PROOF),
  "i18n/actions.ts::setLocale": browser("One browser's language. An assistant's language comes from Accept-Language."),

  // --- team -----------------------------------------------------------------
  "lib/team/actions.ts::inviteMember": person(STEP_UP),
  "lib/team/actions.ts::changeMemberRole": person(STEP_UP),
  "lib/team/actions.ts::revokeMemberAccess": person(STEP_UP),
  "lib/team/actions.ts::acceptInvite": person("Joining a store is the person's choice."),
  "lib/team/actions.ts::setActiveAccount": browser("A grant is bound to one store when it is approved."),
  "lib/team/actions.ts::fetchTeamRosterPage": tool("list_team"),

  // --- products -------------------------------------------------------------
  "lib/products/actions.ts::createProduct": tool("create_product"),
  "lib/products/actions.ts::updateProduct": tool("update_product"),
  "lib/products/actions.ts::deleteProduct": tool("delete_product"),
  "lib/products/import-actions.ts::importProducts": tool("import_products"),
  "lib/products/badge-actions.ts::checkBadgeLabel": tool("check_badge_label"),
  "lib/products/badge-actions.ts::moveProductBadge": tool("move_product_badge"),
  "lib/products/picker-actions.ts::searchCatalogProducts": tool("list_products"),
  "lib/products/preview-actions.ts::getProductPagePreviewData": tool("preview_product_page"),
  "lib/stock/actions.ts::updateStockSettings": tool("update_stock"),

  // --- storefronts ----------------------------------------------------------
  "lib/storefront/actions.ts::createStorefront": tool("create_storefront"),
  "lib/storefront/actions.ts::saveStorefront": tool("save_storefront"),
  "lib/storefront/actions.ts::updateEmbedSettings": tool("update_embed_settings"),
  "lib/storefront/actions.ts::deleteStorefront": tool("delete_storefront"),
  "lib/storefront/actions.ts::rotateEmbedKey": tool("rotate_embed_key"),
  "lib/storefront/actions.ts::fetchStorefrontsPage": tool("list_storefronts"),

  // --- orders, discounts, reviews, moderation -------------------------------
  "lib/orders/actions.ts::markOrderShipped": tool("mark_order_shipped"),
  "lib/orders/actions.ts::refundOrder": tool("refund_order"),
  "lib/discounts/actions.ts::createDiscount": tool("create_discount"),
  "lib/discounts/actions.ts::updateDiscount": tool("update_discount"),
  "lib/discounts/actions.ts::setCodeEnabled": tool("set_code_enabled"),
  "lib/discounts/actions.ts::endSale": tool("end_sale"),
  "lib/discounts/actions.ts::deleteDiscount": tool("delete_discount"),
  "lib/reviews/actions.ts::setReviewVisibility": tool("set_review_visibility"),
  "lib/moderation/review-request.ts::requestModerationReview": tool("request_moderation_review"),
  "lib/moderation/appeals.ts::fileModerationAppeal": tool("file_moderation_appeal"),

  // --- notifications --------------------------------------------------------
  "lib/notifications/actions.ts::fetchNotificationSnapshot": tool("list_notifications"),
  "lib/notifications/actions.ts::fetchUnreadCount": tool("get_unread_count"),
  "lib/notifications/actions.ts::fetchNotificationPage": tool("list_notifications"),
  "lib/notifications/actions.ts::markNotificationRead": tool("mark_notification_read"),
  "lib/notifications/actions.ts::markAllNotificationsRead": tool("mark_all_notifications_read"),
  "lib/notifications/actions.ts::runNotificationAction": person("Its only action accepts a team invite."),
  "lib/notifications/actions.ts::getRealtimeToken": browser("Realtime is a browser's connection. An assistant polls."),

  // --- billing and payouts --------------------------------------------------
  "lib/billing/actions.ts::startCheckout": person(MONEY),
  "lib/billing/actions.ts::openBillingPortal": person(MONEY),
  "lib/billing/actions.ts::cancelPlan": person(MONEY),
  "lib/billing/actions.ts::resumePlan": person(MONEY),
  "lib/payments/connect/actions.ts::startStripeOnboarding": person("Identity checks at Stripe, in the person's own browser."),
  "lib/payments/connect/actions.ts::openStripeDashboard": person("A bearer link to the seller's Stripe account."),

  // --- onboarding -----------------------------------------------------------
  "lib/onboarding/actions.ts::completeOnboarding": browser("Closes the welcome flow someone is looking at."),
  "lib/onboarding/actions.ts::markSetupCelebrated": browser("A card shown once to a person."),
  "lib/onboarding/actions.ts::markEditorTourSeen": browser("A tour shown once to a person."),
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

function serverActions(): string[] {
  const root = join(process.cwd(), "src");
  return sourceFiles(root).flatMap((path) => {
    const text = readFileSync(path, "utf8");
    if (!/^["']use server["']/m.test(text)) return [];
    const relative = path.slice(root.length + 1).replace(/\\/g, "/");
    return [...text.matchAll(/^export async function (\w+)/gm)].map((match) => `${relative}::${match[1]}`);
  });
}

describe("every server action says what it is to an assistant", () => {
  const actions = serverActions();

  it("finds the actions (a broken scan must not pass by finding none)", () => {
    expect(actions.length).toBeGreaterThan(80);
  });

  it("has no action left undecided", () => {
    expect(actions.filter((action) => !COVERAGE[action])).toEqual([]);
  });

  it("has no entry for an action that is gone", () => {
    expect(Object.keys(COVERAGE).filter((action) => !actions.includes(action))).toEqual([]);
  });

  it("names only tools that exist", () => {
    const missing = Object.values(COVERAGE).flatMap((entry) =>
      entry.kind === "tool" && !findTool(entry.name) ? [entry.name] : [],
    );
    expect(missing).toEqual([]);
  });

  it("does not expose anything behind a step-up or a second factor", () => {
    const exposed = Object.entries(COVERAGE).flatMap(([action, entry]) =>
      entry.kind === "tool" && /mfa|sign-in-approval|auth\/actions|billing\/|payments\//.test(action) ? [action] : [],
    );
    expect(exposed).toEqual([]);
  });

  it("exposes no action that calls the step-up gate", () => {
    const root = join(process.cwd(), "src");
    const offenders = Object.entries(COVERAGE).flatMap(([action, entry]) => {
      if (entry.kind !== "tool") return [];
      const [file, name] = action.split("::");
      const text = readFileSync(join(root, file), "utf8");
      const start = text.indexOf(`export async function ${name}`);
      const next = text.indexOf("\nexport async function ", start + 1);
      const body = text.slice(start, next === -1 ? undefined : next);
      return /requireStepUp/.test(body) ? [action] : [];
    });
    expect(offenders).toEqual([]);
  });
});

describe("every tool is well formed", () => {
  it("has a unique snake_case name", () => {
    const names = AGENT_TOOLS.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9_]{2,47}$/);
  });

  it("says what it is for", () => {
    for (const entry of AGENT_TOOLS) {
      expect(entry.title.length, entry.name).toBeGreaterThan(3);
      expect(entry.description.length, entry.name).toBeGreaterThan(15);
    }
  });

  it("has an input a client can be told about, in both directions", () => {
    for (const entry of AGENT_TOOLS) {
      expect(() => z.toJSONSchema(entry.input), entry.name).not.toThrow();
      expect(() => z.toJSONSchema(entry.input, { io: "input" }), entry.name).not.toThrow();
    }
  });

  it("names a real scope and a real role permission", () => {
    for (const entry of AGENT_TOOLS) {
      expect(AGENT_SCOPES[entry.scope], entry.name).toBeDefined();
      expect(TEAM_ACTIONS, entry.name).toContain(entry.permission);
    }
  });

  it("marks every read as read-only, and nothing that writes", () => {
    for (const entry of AGENT_TOOLS) {
      const readScope = entry.scope === "store:read" || entry.scope === "orders:read";
      if (readScope) expect(entry.annotations.readOnlyHint, entry.name).toBe(true);
    }
  });

  it("marks everything that cannot be undone as destructive, behind an opt-in scope", () => {
    for (const entry of AGENT_TOOLS.filter((candidate) => candidate.annotations.destructiveHint)) {
      expect(["destructive", "orders:refund"], entry.name).toContain(entry.scope);
    }
    for (const entry of AGENT_TOOLS.filter((candidate) => candidate.scope === "destructive" || candidate.scope === "orders:refund")) {
      expect(entry.annotations.destructiveHint, entry.name).toBe(true);
    }
  });

  it("takes no field that names a storage key", () => {
    const forbidden = ["imageKey", "digitalFileKey", "image_key", "digital_file_key", "objectKey", "embedKey"];
    for (const entry of AGENT_TOOLS) {
      for (const field of Object.keys(entry.input.shape)) {
        expect(forbidden, `${entry.name}.${field}`).not.toContain(field);
      }
    }
  });

  it("says when it emails a buyer", () => {
    expect(findTool("mark_order_shipped")?.annotations.openWorldHint).toBe(true);
    expect(findTool("refund_order")?.annotations.openWorldHint).toBe(true);
    expect(findTool("mark_order_shipped")?.description).toMatch(/emails the buyer/i);
  });
});

describe("who sees which tool", () => {
  const owner = { accountId: "a", role: "owner", isOwner: true, userId: "a" } as const;
  const teammate = (role: "editor" | "viewer") => ({ accountId: "b", role, isOwner: false, userId: "a" }) as const;
  const allScopes = new Set(Object.keys(AGENT_SCOPES)) as ReadonlySet<keyof typeof AGENT_SCOPES>;

  it("gives a read-only grant nothing that writes, even to the owner", () => {
    const scopes = new Set(["store:read"]) as ReadonlySet<keyof typeof AGENT_SCOPES>;
    const usable = AGENT_TOOLS.filter((entry) => toolAvailable(entry, scopes, owner));
    expect(usable.length).toBeGreaterThan(5);
    expect(usable.every((entry) => entry.annotations.readOnlyHint)).toBe(true);
  });

  it("does not let a scope widen a role: a viewer granted everything writes nothing", () => {
    const usable = AGENT_TOOLS.filter((entry) => toolAvailable(entry, allScopes, teammate("viewer")));
    for (const entry of usable) expect(can("viewer", entry.permission), entry.name).toBe(true);
    expect(usable.map((entry) => entry.name)).not.toContain("create_product");
    expect(usable.map((entry) => entry.name)).not.toContain("refund_order");
  });

  it("keeps refunds the owner's alone, whatever the grant says", () => {
    const refund = findTool("refund_order");
    expect(refund && toolAvailable(refund, allScopes, teammate("editor"))).toBe(false);
    expect(refund && toolAvailable(refund, allScopes, owner)).toBe(true);
  });

  it("does not let a teammate's assistant write to the person's profile as if it were the store", () => {
    for (const name of ["update_username", "update_bio", "save_shipping_policy", "set_avatar"]) {
      const entry = findTool(name);
      expect(entry && toolAvailable(entry, allScopes, teammate("editor")), name).toBe(false);
    }
  });

  it("hides everything from a grant without the scope", () => {
    const none = new Set() as ReadonlySet<keyof typeof AGENT_SCOPES>;
    expect(AGENT_TOOLS.filter((entry) => toolAvailable(entry, none, owner))).toEqual([]);
  });
});
