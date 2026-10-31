import type { MessageKey } from "@/i18n/types";
import type { TeamAction } from "@/lib/team/permissions";

/**
 * WHAT A SELLER CAN GRANT AN ASSISTANT, as data. A new scope is one entry here
 * plus the tools that name it; the consent page, the Connected apps page and
 * the OAuth metadata all read this list.
 *
 * A scope NARROWS a person's role, never widens it: a tool runs only when the
 * grant holds its scope AND the person's role on that store allows it (the
 * action underneath checks the role again, and RLS below that).
 *
 * `requires` is the role permission the scope is pointless without, so the
 * consent page can leave out what this person could not use on this store.
 * `optIn` scopes start unticked: they spend money or cannot be undone, and an
 * assistant that reads a buyer's message could be talked into either.
 */
export type AgentScopeDefinition = {
  label: MessageKey;
  hint: MessageKey;
  requires: TeamAction;
  /** Cannot be unticked: no tool works without it. */
  required?: true;
  /** Always starts unticked, whatever the app asked for: only the person turns
   *  it on. Clients echo back the scope list the server advertises, so "the app
   *  asked for it" says nothing about what anyone wants. */
  optIn?: true;
};

export const AGENT_SCOPES = {
  "store:read": {
    label: "Settings.connectedApps.scopes.storeRead.label",
    hint: "Settings.connectedApps.scopes.storeRead.hint",
    requires: "store.read",
    required: true,
  },
  "orders:read": {
    label: "Settings.connectedApps.scopes.ordersRead.label",
    hint: "Settings.connectedApps.scopes.ordersRead.hint",
    requires: "store.read",
  },
  "products:write": {
    label: "Settings.connectedApps.scopes.productsWrite.label",
    hint: "Settings.connectedApps.scopes.productsWrite.hint",
    requires: "products.write",
  },
  "storefronts:write": {
    label: "Settings.connectedApps.scopes.storefrontsWrite.label",
    hint: "Settings.connectedApps.scopes.storefrontsWrite.hint",
    requires: "storefront.write",
  },
  "discounts:write": {
    label: "Settings.connectedApps.scopes.discountsWrite.label",
    hint: "Settings.connectedApps.scopes.discountsWrite.hint",
    requires: "products.write",
  },
  "reviews:write": {
    label: "Settings.connectedApps.scopes.reviewsWrite.label",
    hint: "Settings.connectedApps.scopes.reviewsWrite.hint",
    requires: "products.write",
  },
  "orders:fulfil": {
    label: "Settings.connectedApps.scopes.ordersFulfil.label",
    hint: "Settings.connectedApps.scopes.ordersFulfil.hint",
    requires: "orders.fulfil",
  },
  "profile:write": {
    label: "Settings.connectedApps.scopes.profileWrite.label",
    hint: "Settings.connectedApps.scopes.profileWrite.hint",
    requires: "store.read",
  },
  "notifications:write": {
    label: "Settings.connectedApps.scopes.notificationsWrite.label",
    hint: "Settings.connectedApps.scopes.notificationsWrite.hint",
    requires: "store.read",
  },
  "moderation:write": {
    label: "Settings.connectedApps.scopes.moderationWrite.label",
    hint: "Settings.connectedApps.scopes.moderationWrite.hint",
    requires: "store.read",
  },
  "orders:refund": {
    label: "Settings.connectedApps.scopes.ordersRefund.label",
    hint: "Settings.connectedApps.scopes.ordersRefund.hint",
    requires: "orders.refund",
    optIn: true,
  },
  destructive: {
    label: "Settings.connectedApps.scopes.destructive.label",
    hint: "Settings.connectedApps.scopes.destructive.hint",
    requires: "products.write",
    optIn: true,
  },
} as const satisfies Record<string, AgentScopeDefinition>;

export type AgentScope = keyof typeof AGENT_SCOPES;

export const AGENT_SCOPE_IDS = Object.keys(AGENT_SCOPES) as AgentScope[];

export function isAgentScope(value: string): value is AgentScope {
  return Object.prototype.hasOwnProperty.call(AGENT_SCOPES, value);
}

/** Keep the names this server knows, dropping anything else. */
export function knownScopes(values: readonly string[]): AgentScope[] {
  return values.filter(isAgentScope);
}

/** Split an OAuth `scope` parameter (space separated) into names. */
export function parseScopeParam(raw: string | null | undefined): string[] {
  return (raw ?? "").split(" ").filter(Boolean);
}

/**
 * What the consent page starts with ticked. An app that names scopes gets what
 * it named; one that names none gets everything. Never an opt-in scope either
 * way, and always the required one.
 */
export function initialScopes(requested: readonly string[]): AgentScope[] {
  const named = knownScopes(requested);
  const picked = named.length > 0 ? named : AGENT_SCOPE_IDS;
  return AGENT_SCOPE_IDS.filter(
    (id) => !("optIn" in AGENT_SCOPES[id]) && (picked.includes(id) || "required" in AGENT_SCOPES[id]),
  );
}
