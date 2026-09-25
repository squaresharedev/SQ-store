import {
  AnalyticsIcon,
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
  Languages,
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
  { label: "Nav.main.overview.label", href: "/dashboard", icon: OverviewIcon },
  { label: "Nav.main.products.label", href: "/products", icon: ProductsIcon },
  { label: "Nav.main.storefront.label", href: "/storefront", icon: StorefrontIcon },
  { label: "Nav.main.orders.label", href: "/orders", icon: OrdersIcon },
  { label: "Nav.main.analytics.label", href: "/analytics", icon: AnalyticsIcon },
  { label: "Nav.main.payments.label", href: "/payments", icon: PaymentsIcon },
];

export const SETTINGS_LINK: NavEntry = {
  label: "Nav.main.settings.label",
  href: "/settings",
  icon: SettingsIcon,
};

export const SETTINGS_NAV: SettingsNavEntry[] = [
  { href: "/settings/account", label: "Nav.settings.account", icon: User },
  // Straight after Account: two-factor, recovery codes and the security
  // activity log. The rail marks it "Recommended" while 2FA is off.
  { href: "/settings/security", label: "Nav.settings.security", icon: ShieldCheck },
  { href: "/settings/legal", label: "Nav.settings.legal", icon: ScrollText },
  { href: "/settings/tax", label: "Nav.settings.tax", icon: Receipt },
  // Beside Tax, not off in the storefront designer where these terms used to
  // be written: both are account-level facts about the business that every
  // storefront and every product reads (20260905_shipping_policy_on_profile).
  { href: "/settings/shipping", label: "Nav.settings.shipping", icon: Truck },
  { href: "/settings/notifications", label: "Nav.settings.notifications", icon: Bell },
  { href: "/settings/language", label: "Nav.settings.language", icon: Languages },
  { href: "/settings/team", label: "Nav.settings.team", icon: Users },
  {
    href: "/settings/danger",
    label: "Nav.settings.danger",
    icon: TriangleAlert,
    danger: true,
  },
];
