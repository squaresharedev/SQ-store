import type { Messages } from "./messages";

type Namespace = keyof Messages;

/**
 * Which catalogue namespaces each part of the app ships to the BROWSER.
 *
 * Server components read the full catalogue and send none of it. Client
 * components need their copy in the page, and shipping the whole catalogue
 * (about 50 KB gzipped, more in languages with longer words) with every
 * document would tax the pages that matter most: the buyer-facing product page
 * and the login page, where a visitor arrives cold. Each route group therefore
 * lists what its client components can ask for.
 *
 * tests/unit/i18n-client-scopes.test.ts fails when a client component reaches
 * for a namespace its route group does not ship, so adding one here is the fix
 * and forgetting to is caught before release.
 */

/** Needed by every page: toasts, action errors, form validation, the error pages. */
const SHELL = ["Common", "LocaleSwitcher", "ErrorPage", "Errors", "Validation"] as const satisfies readonly Namespace[];

const ALL_NAMESPACES = null;

export const CLIENT_SCOPES = {
  /** The root layout alone: enough for anything outside a route group. */
  shell: [],
  /** Login, reset password, two-factor. */
  auth: ["Auth", "Notifications"],
  /** The hosted product page. Deliberately the smallest: it is the coldest visit. */
  public: ["ProductPage"],
  /** The dashboard and settings. The designer's copy is not on these pages. */
  app: [
    "Analytics",
    "Auth",
    "Dashboard",
    "Nav",
    "Notifications",
    "Onboarding",
    "Orders",
    "Payments",
    "Products",
    "Search",
    "Settings",
  ],
  /** The storefront list and designer, and the /dev harness pages. */
  full: ALL_NAMESPACES,
} as const satisfies Record<string, readonly Namespace[] | null>;

export type ClientScope = keyof typeof CLIENT_SCOPES;

/** The namespaces a scope ships; null means everything. Exported for the test. */
export function scopeNamespaces(scope: ClientScope): readonly Namespace[] | null {
  const own = CLIENT_SCOPES[scope];
  return own === null ? null : [...SHELL, ...own];
}

/**
 * The namespaces a scope adds on top of the shell the root layout ships:
 * its own list, or (for null) everything the shell does not already carry.
 */
export function pickScope(messages: Messages, scope: ClientScope): Partial<Messages> {
  const own = CLIENT_SCOPES[scope];
  const names = own === null ? (Object.keys(messages) as Namespace[]).filter((n) => !SHELL.includes(n as never)) : own;
  const picked: Partial<Messages> = {};
  for (const name of names) Object.assign(picked, { [name]: messages[name] });
  return picked;
}

/** The root layout's own share: the shell alone. */
export function pickShell(messages: Messages): Partial<Messages> {
  const picked: Partial<Messages> = {};
  for (const name of SHELL) Object.assign(picked, { [name]: messages[name] });
  return picked;
}
