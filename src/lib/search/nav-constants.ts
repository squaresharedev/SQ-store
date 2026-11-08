import {
  AnalyticsIcon,
  DiscountsIcon,
  OrdersIcon,
  OverviewIcon,
  PaymentsIcon,
  ProductsIcon,
  SettingsIcon,
  StorefrontIcon,
  type NavIconProps,
} from "@/components/dashboard/nav-icons";
import {
  Bell,
  Gem,
  Globe,
  Plug,
  Receipt,
  ScrollText,
  ShieldCheck,
  TriangleAlert,
  Truck,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { MessageKey } from "@/i18n/types";
import {
  ANALYTICS_PATH,
  LANGUAGE_SETTINGS_PATH,
  ORDERS_PATH,
  OVERVIEW_PATH,
  PAYMENTS_PATH,
  SETTINGS_PATH,
} from "@/lib/dashboard/paths";
import { PRODUCTS_PATH } from "@/lib/products/paths";
import { CONNECTED_APPS_PATH } from "@/lib/agent/paths";
import { DISCOUNTS_PATH } from "@/lib/discounts/paths";
import { BILLING_SETTINGS_PATH } from "@/lib/billing/paths";
import { STOREFRONT_LIST_PATH } from "@/lib/storefront/paths";
import { TRADER_IDENTITY_HREF } from "@/lib/settings/trader-identity";

/**
 * THE APP'S NAVIGATION MAP: declared once, consumed three times.
 *
 * The dashboard rail (`Sidebar`), the settings rail (`SettingsShell`) and the
 * universal search registry (`@/lib/search/registry`) all read from here. They
 * used to declare their own copies, which meant a new page appeared in the
 * sidebar and stayed invisible to search until someone noticed. One list, no
 * drift.
 *
 * Client-side data (the dashboard icons are motion components), so this module
 * is only ever imported from Client Components. Nothing here is a secret and
 * nothing here is a permission check: the search registry gates entries on
 * `can()` separately, and every route re-checks auth server-side regardless.
 *
 * LABELS ARE MESSAGE KEYS, not English. Each consumer resolves them with its
 * own translator, so the rail, the settings strip and the search index all
 * read in the seller's language from this one list.
 */

/** A dashboard rail destination. Its icon is an animated motion component. */
export type NavEntry = {
  label: MessageKey;
  /** One-line description shown as a tooltip on hover (desktop) and as a subtitle
   *  in search results. Maps to the same-named key in nav.json. */
  description?: MessageKey;
  href: string;
  icon: (props: NavIconProps) => React.ReactNode;
};

/** A settings rail destination. Plain lucide icon, plus the danger tint. */
export type SettingsNavEntry = {
  label: MessageKey;
  href: string;
  icon: LucideIcon;
  danger?: boolean;
};

export const MAIN_NAV: NavEntry[] = [
  // The Overview page lives at /dashboard ("/" merely redirects there);
  // linking it directly keeps the active state working and skips the hop.
  { label: "Nav.main.overview.label", description: "Nav.main.overview.description", href: OVERVIEW_PATH, icon: OverviewIcon },
  { label: "Nav.main.products.label", description: "Nav.main.products.description", href: PRODUCTS_PATH, icon: ProductsIcon },
  { label: "Nav.main.storefront.label", description: "Nav.main.storefront.description", href: STOREFRONT_LIST_PATH, icon: StorefrontIcon },
  { label: "Nav.main.orders.label", description: "Nav.main.orders.description", href: ORDERS_PATH, icon: OrdersIcon },
  { label: "Nav.main.discounts.label", description: "Nav.main.discounts.description", href: DISCOUNTS_PATH, icon: DiscountsIcon },
  { label: "Nav.main.analytics.label", description: "Nav.main.analytics.description", href: ANALYTICS_PATH, icon: AnalyticsIcon },
  { label: "Nav.main.payments.label", description: "Nav.main.payments.description", href: PAYMENTS_PATH, icon: PaymentsIcon },
];

export const SETTINGS_LINK: NavEntry = {
  label: "Nav.main.settings.label",
  description: "Nav.main.settings.description",
  href: SETTINGS_PATH,
  icon: SettingsIcon,
};

export const SETTINGS_NAV: SettingsNavEntry[] = [
  { href: "/settings/account", label: "Nav.settings.account", icon: User },
  // A card on Account rather than a page, named here so the rail says where it is.
  { href: LANGUAGE_SETTINGS_PATH, label: "Nav.settings.language", icon: Globe },
  // Near the top: the one page a seller has to fill in before they can sell.
  { href: TRADER_IDENTITY_HREF, label: "Nav.settings.tax", icon: Receipt },
  // Beside Business, not off in the storefront designer where these terms used
  // to be written: both are account-level facts about the business that every
  // storefront and every product reads (20260905_shipping_policy_on_profile).
  { href: "/settings/shipping", label: "Nav.settings.shipping", icon: Truck },
  // Two-factor, recovery codes and the security activity log. The rail marks
  // it "Recommended" while 2FA is off.
  { href: "/settings/security", label: "Nav.settings.security", icon: ShieldCheck },
  // The store's plan, its fee per sale and its invoices (lib/billing).
  { href: BILLING_SETTINGS_PATH, label: "Nav.settings.billing", icon: Gem },
  { href: "/settings/legal", label: "Nav.settings.legal", icon: ScrollText },
  { href: "/settings/notifications", label: "Nav.settings.notifications", icon: Bell },
  { href: "/settings/team", label: "Nav.settings.team", icon: Users },
  // Assistants connected through MCP (lib/agent): each one a way into the store.
  { href: CONNECTED_APPS_PATH, label: "Nav.settings.connectedApps", icon: Plug },
  {
    href: "/settings/danger",
    label: "Nav.settings.danger",
    icon: TriangleAlert,
    danger: true,
  },
];
