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
import type { MessageKey } from "@/i18n/types";
import type {
  SearchGroup,
  SearchResult,
  SearchTranslator,
} from "@/lib/search/types";
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
 *
 * IN THE READER'S LANGUAGE. Titles, breadcrumbs and group labels are message
 * keys here, resolved through the caller's translator when the index is built,
 * so a Czech seller both SEES and MATCHES Czech titles. The synonyms stay
 * English and are matched in every language: they are search vocabulary, not
 * display copy, and they keep everything that finds a result today finding it.
 * The index is built once per translator (one per locale in practice) and
 * reused on every keystroke.
 */

/**
 * A palette row: a shared catalogue entry whose payload is the SearchResult
 * the UI renders and navigates to. The section is the result's own type, so
 * "Pages", "Actions" and "Settings" need no second classification.
 */
type LocalEntry = SearchEntry<SearchResult>;

/** An entry before translation: its copy is still message keys. */
type EntrySpec = {
  id: string;
  type: SearchResult["type"];
  title: MessageKey;
  /** The settings section it sits under, for the "Settings › Account" crumb. */
  section?: MessageKey;
  /** A plain second line, for an entry with no section to sit under. */
  subtitle?: MessageKey;
  href: string;
  synonyms?: string[];
  permission?: TeamAction;
};

function entry(
  id: string,
  result: Omit<SearchResult, "id">,
  synonyms: readonly string[] = [],
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

function resolveSpec(spec: EntrySpec, t: SearchTranslator): LocalEntry {
  return entry(
    spec.id,
    {
      type: spec.type,
      title: t(spec.title),
      subtitle: spec.section
        ? breadcrumb(spec.section, t)
        : spec.subtitle
          ? t(spec.subtitle)
          : undefined,
      href: spec.href,
    },
    spec.synonyms,
    spec.permission,
  );
}

/** "Settings › Account". A path of two names, not a sentence, so it is built
 *  from the nav labels themselves and can never drift from the rail. */
function breadcrumb(section: MessageKey, t: SearchTranslator): string {
  return `${t(SETTINGS_LINK.label)} › ${t(section)}`;
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

const PAGES: EntrySpec[] = [...MAIN_NAV, SETTINGS_LINK].map((link) => ({
  id: `page:${link.href}`,
  type: "page",
  title: link.label,
  href: link.href,
  synonyms: PAGE_SYNONYMS[link.href] ?? [],
}));

/** Extra words a settings section answers to, beyond its own name. */
const SECTION_SYNONYMS: Record<string, string[]> = {
  "/settings/language": ["change language", "locale", "translate", "translation", "english", "czech"],
};

const SETTINGS_SECTIONS: EntrySpec[] = SETTINGS_NAV.map((link) => ({
  id: `settings:${link.href}`,
  type: "settings",
  title: link.label,
  subtitle: SETTINGS_LINK.label,
  href: link.href,
  synonyms: SECTION_SYNONYMS[link.href],
}));

/** The settings sections the fields below sit in, by the rail's own labels. */
const ACCOUNT: MessageKey = "Nav.settings.account";
const SECURITY: MessageKey = "Nav.settings.security";
const BUSINESS: MessageKey = "Nav.settings.tax";
const NOTIFICATIONS: MessageKey = "Nav.settings.notifications";
const LEGAL: MessageKey = "Nav.settings.legal";
const DANGER: MessageKey = "Nav.settings.danger";

/**
 * Individual settings CONTROLS. The `#hash` targets the element id on the
 * section that owns the field, so the browser scrolls straight to it.
 */
const SETTINGS_FIELDS: EntrySpec[] = [
  // One name now, so the old "display name" search terms land here too: the
  // username IS the store name buyers see as well as the sign-in handle.
  {
    id: "field:username",
    type: "settings",
    title: "Search.fields.username",
    section: ACCOUNT,
    href: "/settings/account#username",
    synonyms: [
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
  },
  {
    id: "field:avatar",
    type: "settings",
    title: "Search.fields.avatar",
    section: ACCOUNT,
    href: "/settings/account#avatar",
    synonyms: ["avatar", "profile picture", "image", "headshot", "logo", "store logo"],
  },
  {
    id: "field:email",
    type: "settings",
    title: "Search.fields.email",
    section: ACCOUNT,
    href: "/settings/account#email",
    synonyms: ["change email", "mail", "address", "contact email"],
  },
  {
    id: "field:password",
    type: "settings",
    title: "Search.fields.password",
    section: ACCOUNT,
    href: "/settings/account#password",
    synonyms: [
      "change password",
      "reset password",
      "forgot password",
      "passphrase",
      "security",
      "credentials",
    ],
  },
  {
    id: "field:two-factor",
    type: "settings",
    title: "Search.fields.twoFactor",
    section: SECURITY,
    href: "/settings/security#two-factor",
    synonyms: [
      "2fa",
      "mfa",
      "two factor",
      "two-step",
      "2 step verification",
      "authenticator",
      "authenticator app",
      "google authenticator",
      "totp",
      "one time code",
      "security",
    ],
  },
  {
    id: "field:recovery-codes",
    type: "settings",
    title: "Search.fields.recoveryCodes",
    section: SECURITY,
    href: "/settings/security#recovery-codes",
    synonyms: ["backup codes", "lost phone", "2fa recovery", "account recovery"],
  },
  {
    id: "field:security-activity",
    type: "settings",
    title: "Search.fields.securityActivity",
    section: SECURITY,
    href: "/settings/security#activity",
    synonyms: ["security log", "login history", "audit log", "recent activity"],
  },
  {
    id: "field:sign-out",
    type: "settings",
    title: "Search.fields.signOut",
    section: ACCOUNT,
    href: "/settings/account#sign-out",
    synonyms: ["log out", "logout", "leave", "exit"],
  },
  {
    id: "field:seller-bio",
    type: "settings",
    title: "Search.fields.bio",
    section: ACCOUNT,
    href: "/settings/account#bio",
    synonyms: ["seller bio", "about me", "about", "description", "who i am"],
  },
  // The page and its fields carry the names the page itself uses ("Business &
  // seller details", "Trader name"), so a result never reads like a different
  // screen from the one it opens. The old names stay as synonyms: people still
  // type "tax" and "business name".
  {
    id: "field:vat",
    type: "settings",
    title: "Search.fields.vat",
    section: BUSINESS,
    href: "/settings/tax#vat",
    synonyms: ["tax number", "vat number", "tax id", "eu vat"],
  },
  {
    id: "field:business-name",
    type: "settings",
    title: "Search.fields.businessName",
    section: BUSINESS,
    href: "/settings/tax#business-name",
    synonyms: ["business name", "company name", "legal name", "trading name", "seller details", "tax"],
  },
  {
    id: "field:tax-country",
    type: "settings",
    title: "Search.fields.country",
    section: BUSINESS,
    href: "/settings/tax#country",
    synonyms: ["tax country", "eu", "residence", "jurisdiction"],
  },
  {
    id: "field:seller-address",
    type: "settings",
    title: "Search.fields.address",
    section: BUSINESS,
    href: "/settings/tax#address",
    synonyms: ["seller address", "postal address", "trader address", "who is selling"],
  },
  {
    id: "field:seller-email",
    type: "settings",
    title: "Search.fields.contactEmail",
    section: BUSINESS,
    href: "/settings/tax#contact-email",
    synonyms: ["seller email", "buyer contact", "support email"],
  },
  {
    id: "field:seller-phone",
    type: "settings",
    title: "Search.fields.phone",
    section: BUSINESS,
    href: "/settings/tax#phone",
    synonyms: ["phone number", "contact number", "seller phone"],
  },
  {
    id: "field:notify-sales",
    type: "settings",
    title: "Search.fields.salesEmails",
    section: NOTIFICATIONS,
    href: "/settings/notifications#preferences",
    synonyms: ["email me when something sells", "order emails", "sale alerts"],
  },
  {
    id: "field:notify-marketing",
    type: "settings",
    title: "Search.fields.marketingEmails",
    section: NOTIFICATIONS,
    href: "/settings/notifications#preferences",
    synonyms: ["tips", "newsletter", "marketplace news", "unsubscribe"],
  },
  {
    id: "field:notify-product",
    type: "settings",
    title: "Search.fields.productEmails",
    section: NOTIFICATIONS,
    href: "/settings/notifications#preferences",
    synonyms: ["feature announcements", "changelog emails"],
  },
  {
    id: "field:legal",
    type: "settings",
    title: "Search.fields.termsOfService",
    section: LEGAL,
    href: "/settings/legal",
    synonyms: ["seller agreement", "terms of use", "terms", "privacy policy", "gdpr", "contract"],
  },
  {
    id: "field:export",
    type: "settings",
    title: "Search.fields.exportData",
    section: DANGER,
    href: "/settings/danger#export",
    synonyms: ["download my data", "gdpr export", "backup", "data dump"],
  },
  {
    id: "field:delete-account",
    type: "settings",
    title: "Search.fields.deleteAccount",
    section: DANGER,
    href: "/settings/danger#delete",
    synonyms: ["close account", "remove account", "cancel account", "delete everything"],
  },
];

/** Things you DO, not places you go. Ordered by how often they're wanted. */
const ACTIONS: EntrySpec[] = [
  {
    id: "action:new-product",
    type: "action",
    title: "Search.actions.newProduct",
    href: "/products/new",
    synonyms: ["add product", "create product", "sell something", "upload", "list an item"],
    permission: "products.write",
  },
  {
    id: "action:new-storefront",
    type: "action",
    title: "Search.actions.newStorefront",
    href: "/storefront",
    synonyms: ["add storefront", "create shop", "design a store", "embed"],
    permission: "storefront.write",
  },
  {
    id: "action:invite-member",
    type: "action",
    title: "Search.actions.inviteMember",
    href: "/settings/team#invite",
    synonyms: ["add teammate", "add user", "share access", "collaborator", "invite"],
    permission: "team.invite",
  },
  {
    id: "action:notifications",
    type: "action",
    title: "Search.actions.notificationHistory",
    href: "/notifications",
    synonyms: ["alerts", "inbox", "unread", "bell"],
  },
  // The welcome flow's map, on demand. Last on purpose: the empty state shows
  // the first three actions, and this one is for someone who goes looking.
  {
    id: "action:show-me-around",
    type: "action",
    title: "Search.actions.showMeAround",
    href: "/dashboard?tour=1",
    synonyms: ["tour", "help", "where is", "onboarding", "getting started", "guide", "how does this work"],
  },
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
 *
 * Resolved per translator like every other entry: that catalogue carries
 * message keys, and settingIndexFields turns them into the reader's language.
 */
function storefrontDesignSettings(t: SearchTranslator): LocalEntry[] {
  return STOREFRONT_SETTINGS.map((setting) => {
    const { title, subtitle, keywords } = settingIndexFields(setting, t);
    return entry(
      `storefront-setting:${setting.id}`,
      { type: "settings", title, subtitle, href: settingHref(setting.id) },
      [...keywords],
      "storefront.write",
    );
  });
}

/** The palette's sections. Keys ARE result types, so an entry classifies
 *  itself and a fourth local type would need no second list. The order is only
 *  the tiebreak; searchCatalog leads with whatever answered best. */
const SECTIONS: { key: SearchResult["type"]; label: MessageKey }[] = [
  { key: "page", label: "Search.sections.pages" },
  { key: "action", label: "Search.sections.actions" },
  { key: "settings", label: "Search.sections.settings" },
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

/** One locale's resolved index. */
type LocalIndex = {
  all: LocalEntry[];
  sections: SectionSpec[];
  // Pages are DELIBERATELY absent: the sidebar already shows every page, so
  // recommending them here is noise. They stay fully searchable — this list
  // only shapes the empty state, never the query path.
  emptyState: { type: SearchResult["type"]; label: string; source: LocalEntry[] }[];
};

/**
 * Built once per translator. The ranker memoises its terms per entry OBJECT,
 * so reusing the same entries across keystrokes is what keeps matching cheap.
 */
const INDEXES = new WeakMap<SearchTranslator, LocalIndex>();

function localIndex(t: SearchTranslator): LocalIndex {
  const cached = INDEXES.get(t);
  if (cached) return cached;

  const resolve = (specs: EntrySpec[]) => specs.map((spec) => resolveSpec(spec, t));
  const actions = resolve(ACTIONS);
  const fields = resolve(SETTINGS_FIELDS);
  const sectionLabel = (key: SearchResult["type"]) =>
    t(SECTIONS.find((section) => section.key === key)!.label);

  const index: LocalIndex = {
    all: [
      ...resolve(PAGES),
      ...actions,
      ...resolve(SETTINGS_SECTIONS),
      ...fields,
      ...storefrontDesignSettings(t),
    ],
    sections: SECTIONS.map(({ key, label }) => ({ key, label: t(label) })),
    emptyState: [
      // The first three actions only, same fit-without-scrolling budget as above.
      { type: "action", label: sectionLabel("action"), source: actions.slice(0, 3) },
      {
        type: "settings",
        label: sectionLabel("settings"),
        source: fields.filter((item) => SUGGESTION_SETTINGS_IDS.has(item.id)),
      },
    ],
  };
  INDEXES.set(t, index);
  return index;
}

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
  options: { t: SearchTranslator; role?: TeamRole | null; limit?: number },
): SearchGroup[] {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const role = options.role;
  const term = query.trim();
  const index = localIndex(options.t);

  if (!term) {
    return index.emptyState.map(({ type, label, source }) => ({
      type,
      label,
      results: allowedFor(source, role).map((item) => item.payload),
    })).filter((group) => group.results.length > 0);
  }

  return searchCatalog(index.all, term, { sections: index.sections, limit, role })
    .map((section) => ({
      // The section key IS the result type; the cast is the one place that
      // knowledge is spent, and SECTIONS is built from those types above.
      type: section.key as SearchResult["type"],
      label: section.label,
      results: section.hits.map((hit) => hit.entry.payload),
    }));
}
