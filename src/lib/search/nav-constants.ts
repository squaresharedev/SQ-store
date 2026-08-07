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
  Receipt,
  ScrollText,
  TriangleAlert,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * THE APP'S NAVIGATION MAP — declared once, consumed three times.
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
 */

/** A dashboard rail destination. Its icon is an animated motion component. */
export type NavEntry = {
  label: string;
  href: string;
  icon: (props: NavIconProps) => React.ReactNode;
};

/** A settings rail destination. Plain lucide icon, plus the danger tint. */
export type SettingsNavEntry = {
  label: string;
  href: string;
  icon: LucideIcon;
  danger?: boolean;
};

export const MAIN_NAV: NavEntry[] = [
  // The Overview page lives at /dashboard ("/" merely redirects there);
  // linking it directly keeps the active state working and skips the hop.
  { label: "Overview", href: "/dashboard", icon: OverviewIcon },
  { label: "Products", href: "/products", icon: ProductsIcon },
  { label: "Storefront", href: "/storefront", icon: StorefrontIcon },
  { label: "Orders", href: "/orders", icon: OrdersIcon },
  { label: "Analytics", href: "/analytics", icon: AnalyticsIcon },
  { label: "Payments", href: "/payments", icon: PaymentsIcon },
];

export const SETTINGS_LINK: NavEntry = {
  label: "Settings",
  href: "/settings",
  icon: SettingsIcon,
};

export const SETTINGS_NAV: SettingsNavEntry[] = [
  { href: "/settings/account", label: "Account", icon: User },
  { href: "/settings/legal", label: "Legal", icon: ScrollText },
  { href: "/settings/tax", label: "Tax", icon: Receipt },
  { href: "/settings/notifications", label: "Notifications", icon: Bell },
  { href: "/settings/team", label: "Team & access", icon: Users },
  {
    href: "/settings/danger",
    label: "Danger zone",
    icon: TriangleAlert,
    danger: true,
  },
];
