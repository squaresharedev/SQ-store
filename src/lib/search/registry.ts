import {
  allowedFor,
  searchCatalog,
  type SearchEntry,
  type SectionSpec,
} from "@/lib/search/catalog";
import {
  MAIN_NAV,
  SETTINGS_LINK,
  SETTINGS_NAV,
} from "@/lib/search/nav-constants";
import type { SearchGroup, SearchResult } from "@/lib/search/types";
import {
  STOREFRONT_SETTINGS,
  settingHref,
  settingIndexFields,
} from "@/lib/storefront/setting-ref";
import type { TeamAction, TeamRole } from "@/lib/team/permissions";

/**
 * THE LOCAL INDEX — every page, settings section, settings FIELD and quick
 * action, matched synchronously in the browser with no network at all.
 *
 * This is what makes the search bar "always work". The remote half (products,
 * orders, storefronts, team, notifications) can be slow, rate limited, offline
 * or 500ing; the palette still answers on the first keystroke, because
 * everything here is a few hundred strings already in the bundle.
 *
 * Pages come from the shared nav map, so a route added to the sidebar is
 * searchable without touching this file. Settings FIELDS are hand-written,
 * because "change my username" has to find a control that no route list knows
 * about — that mapping only exists here.
 *
 * SYNONYMS are the point, not decoration. People search for what they want to
 * do ("log out", "vat", "add product"), not for the label we happened to pick.
 *
 * They no longer have to be exhaustive, though. The ranker matches per WORD
 * and forgives spelling, typos and abbreviations on its own (lib/search/rank
 * and lib/search/vocabulary), so "bg", "colour" and "passwrod" need no entry
 * anywhere. What still has to be written down is the vocabulary a rule could
 * never derive: other names for the same thing, and the phrasing someone
 * reaches for when they do not know its name.
 */

/**
 * A palette row: a shared catalogue entry whose payload is the SearchResult
 * the UI renders and navigates to. The section is the result's own type, so
 * "Pages", "Actions" and "Settings" need no second classification.
 */
type LocalEntry = SearchEntry<SearchResult>;

function entry(
  id: string,
  result: Omit<SearchResult, "id">,
  synonyms: string[] = [],
  permission?: TeamAction,
): LocalEntry {
  return {
    id,
    title: result.title,
    subtitle: result.subtitle,
    keywords: synonyms,
    section: result.type,
    permission,
    payload: { id, ...result },
  };
}

const PAGE_SYNONYMS: Record<string, string[]> = {
  "/dashboard": ["home", "overview", "summary", "start"],
  "/products": ["catalogue", "catalog", "items", "inventory", "stock", "listings"],
  "/storefront": ["shop", "store", "designer", "editor", "embed", "widget"],
  "/orders": ["sales", "purchases", "transactions", "buyers", "customers"],
  "/analytics": ["stats", "statistics", "metrics", "reports", "revenue", "charts"],
  "/payments": ["payouts", "stripe", "money", "bank", "balance"],
  "/settings": ["preferences", "options", "configuration", "account"],
};

const PAGES: LocalEntry[] = [...MAIN_NAV, SETTINGS_LINK].map((link) =>
  entry(
    `page:${link.href}`,
    { type: "page", title: link.label, href: link.href },
    PAGE_SYNONYMS[link.href] ?? [],
  ),
);

const SETTINGS_SECTIONS: LocalEntry[] = SETTINGS_NAV.map((link) =>
  entry(`settings:${link.href}`, {
    type: "settings",
    title: link.label,
    subtitle: "Settings",
    href: link.href,
  }),
);

/**
 * Individual settings CONTROLS. The `#hash` targets the element id on the
 * section that owns the field, so the browser scrolls straight to it.
 */
const SETTINGS_FIELDS: LocalEntry[] = [
  // One name now, so the old "display name" search terms land here too: the
  // username IS the store name buyers see as well as the sign-in handle.
  entry(
    "field:username",
    { type: "settings", title: "Username", subtitle: "Settings › Account", href: "/settings/account#username" },
    [
      "handle",
      "sign in name",
      "login name",
      "at name",
      "@",
      "display name",
      "store name",
      "public name",
      "shop name",
      "rename",
      "nickname",
    ],
  ),
  entry(
    "field:avatar",
    { type: "settings", title: "Profile photo", subtitle: "Settings › Account", href: "/settings/account#avatar" },
    ["avatar", "profile picture", "image", "headshot", "logo", "store logo"],
  ),
  entry(
    "field:email",
    { type: "settings", title: "Email address", subtitle: "Settings › Account", href: "/settings/account#email" },
    ["change email", "mail", "address", "contact email"],
  ),
  entry(
    "field:password",
    { type: "settings", title: "Password", subtitle: "Settings › Account", href: "/settings/account#password" },
    [
      "change password",
      "reset password",
      "forgot password",
      "passphrase",
      "security",
      "credentials",
    ],
  ),
  entry(
    "field:sign-out",
    { type: "settings", title: "Sign out", subtitle: "Settings › Account", href: "/settings/account#sign-out" },
    ["log out", "logout", "leave", "exit"],
  ),
  entry(
    "field:vat",
    { type: "settings", title: "VAT ID", subtitle: "Settings › Tax", href: "/settings/tax#vat" },
    ["tax number", "vat number", "tax id", "eu vat"],
  ),
  entry(
    "field:business-name",
    { type: "settings", title: "Business name", subtitle: "Settings › Tax", href: "/settings/tax#business-name" },
    ["company name", "legal name", "trading name"],
  ),
  entry(
    "field:tax-country",
    { type: "settings", title: "Tax country", subtitle: "Settings › Tax", href: "/settings/tax#country" },
    ["country", "eu", "residence", "jurisdiction"],
  ),
  entry(
    "field:seller-address",
    { type: "settings", title: "Business address", subtitle: "Settings › Tax", href: "/settings/tax#address" },
    ["seller address", "postal address", "trader address", "who is selling"],
  ),
  entry(
    "field:seller-email",
    { type: "settings", title: "Contact email", subtitle: "Settings › Tax", href: "/settings/tax#contact-email" },
    ["seller email", "buyer contact", "support email"],
  ),
  entry(
    "field:seller-phone",
    { type: "settings", title: "Seller phone", subtitle: "Settings › Tax", href: "/settings/tax#phone" },
    ["phone number", "contact number", "seller phone"],
  ),
  entry(
    "field:notify-sales",
    { type: "settings", title: "Sales emails", subtitle: "Settings › Notifications", href: "/settings/notifications#preferences" },
    ["email me when something sells", "order emails", "sale alerts"],
  ),
  entry(
    "field:notify-marketing",
    { type: "settings", title: "Marketing emails", subtitle: "Settings › Notifications", href: "/settings/notifications#preferences" },
    ["tips", "newsletter", "marketplace news", "unsubscribe"],
  ),
  entry(
    "field:notify-product",
    { type: "settings", title: "Product update emails", subtitle: "Settings › Notifications", href: "/settings/notifications#preferences" },
    ["feature announcements", "changelog emails"],
  ),
  entry(
    "field:legal",
    { type: "settings", title: "Seller agreement", subtitle: "Settings › Legal", href: "/settings/legal" },
    ["terms of service", "terms", "privacy policy", "gdpr", "contract"],
  ),
  entry(
    "field:export",
    { type: "settings", title: "Export my data", subtitle: "Settings › Danger zone", href: "/settings/danger#export" },
    ["download my data", "gdpr export", "backup", "data dump"],
  ),
  entry(
    "field:delete-account",
    { type: "settings", title: "Delete account", subtitle: "Settings › Danger zone", href: "/settings/danger#delete" },
    ["close account", "remove account", "cancel account", "delete everything"],
  ),
];

/** Things you DO, not places you go. Ordered by how often they're wanted. */
const ACTIONS: LocalEntry[] = [
  entry(
    "action:new-product",
    { type: "action", title: "New product", href: "/products/new" },
    ["add product", "create product", "sell something", "upload", "list an item"],
    "products.write",
  ),
  entry(
    "action:new-storefront",
    { type: "action", title: "New storefront", href: "/storefront" },
    ["add storefront", "create shop", "design a store", "embed"],
    "storefront.write",
  ),
  entry(
    "action:invite-member",
    { type: "action", title: "Invite a team member", href: "/settings/team#invite" },
    ["add teammate", "add user", "share access", "collaborator", "invite"],
    "team.invite",
  ),
  entry(
    "action:notifications",
    { type: "action", title: "Notification history", href: "/notifications" },
    ["alerts", "inbox", "unread", "bell"],
  ),
];

/**
 * Every setting inside the storefront designer, derived from the ONE catalogue
 * (lib/storefront/setting-ref) that the designer's own filter field also reads.
 * Adding a storefront setting in one place makes it findable in both.
 *
 * The href carries no storefront id, because a static module cannot know one.
 * Inside the editor that never matters: the designer intercepts its own
 * `?setting=` links and opens the panel in place without navigating. From
 * anywhere else the link lands on the storefront list, which is the right
 * destination for a seller who has not opened one yet.
 */
const STOREFRONT_DESIGN_SETTINGS: LocalEntry[] = STOREFRONT_SETTINGS.map(
  (setting) => {
    const { title, subtitle, keywords } = settingIndexFields(setting);
    return entry(
      `storefront-setting:${setting.id}`,
      { type: "settings", title, subtitle, href: settingHref(setting.id) },
      [...keywords],
      "storefront.write",
    );
  },
);

const ALL_ENTRIES: LocalEntry[] = [
  ...PAGES,
  ...ACTIONS,
  ...SETTINGS_SECTIONS,
  ...SETTINGS_FIELDS,
  ...STOREFRONT_DESIGN_SETTINGS,
];

/** The palette's sections. Keys ARE result types, so an entry classifies
 *  itself and a fourth local type would need no second list. The order is only
 *  the tiebreak; searchCatalog leads with whatever answered best. */
const SECTIONS: SectionSpec[] = [
  { key: "page", label: "Pages" },
  { key: "action", label: "Actions" },
  { key: "settings", label: "Settings" },
];

/**
 * The EMPTY-STATE curation. An empty palette used to suggest only the nav
 * pages — the tabs already one glance away in the sidebar, i.e. the least
 * useful thing to suggest. What people actually open a search for is the
 * buried stuff: reset my password, export my data, invite someone. So the
 * empty state leads with actions and a hand-picked set of settings intents,
 * and recommends no pages at all.
 *
 * The settings picks reference existing entries BY ID (never duplicated), so
 * their titles, synonyms and deep-link hashes stay defined in one place.
 */
// Three, not every useful field: the resting card must FIT WITHOUT SCROLLING
// (a dropdown that opens pre-scrolled reads as overflowing), and everything
// trimmed here is still one keystroke away in the query path.
const SUGGESTION_SETTINGS_IDS = new Set([
  "field:password", // "reset password" lives in its synonyms
  "field:username",
  "field:export",
]);

// Pages are DELIBERATELY absent: the sidebar already shows every page, so
// recommending them here is noise. They stay fully searchable — this list
// only shapes the empty state, never the query path.
const EMPTY_STATE_GROUPS: {
  type: SearchResult["type"];
  label: string;
  source: LocalEntry[];
}[] = [
  // The first three actions only, same fit-without-scrolling budget as above.
  { type: "action", label: "Actions", source: ACTIONS.slice(0, 3) },
  {
    type: "settings",
    label: "Settings",
    source: SETTINGS_FIELDS.filter((item) => SUGGESTION_SETTINGS_IDS.has(item.id)),
  },
];

const DEFAULT_LIMIT = 12;

/**
 * Match the local index. Synchronous by design: it runs inside the same render
 * as the keystroke, so results never lag the caret.
 *
 * The matching, the permission gate and the grouping all live in
 * lib/search/catalog, which the storefront editor's own field also uses. This
 * function is only the palette's half: its entries, and the curation an empty
 * query gets instead of a void.
 */
export function searchLocalRegistry(
  query: string,
  options?: { role?: TeamRole | null; limit?: number },
): SearchGroup[] {
  const limit = options?.limit ?? DEFAULT_LIMIT;
  const role = options?.role;
  const term = query.trim();

  if (!term) {
    return EMPTY_STATE_GROUPS.map(({ type, label, source }) => ({
      type,
      label,
      results: allowedFor(source, role).map((item) => item.payload),
    })).filter((group) => group.results.length > 0);
  }

  return searchCatalog(ALL_ENTRIES, term, { sections: SECTIONS, limit, role })
    .map((section) => ({
      // The section key IS the result type; the cast is the one place that
      // knowledge is spent, and SECTIONS is built from those types above.
      type: section.key as SearchResult["type"],
      label: section.label,
      results: section.hits.map((hit) => hit.entry.payload),
    }));
}
