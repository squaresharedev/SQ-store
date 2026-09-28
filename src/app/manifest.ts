import type { MetadataRoute } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { BRAND_NAME, BRAND_SURFACE } from "@/lib/brand";
import { ANALYTICS_PATH, OVERVIEW_PATH, SETTINGS_PATH } from "@/lib/dashboard/paths";
import { MANIFEST_ICONS } from "@/lib/pwa/icons";
import { PRODUCTS_PATH } from "@/lib/products/paths";
import { STOREFRONT_LIST_PATH } from "@/lib/storefront/paths";

/**
 * /manifest.webmanifest: what makes the dashboard installable as an app
 * (Chrome and Edge's "Install", Android's "Add to Home screen"). Next links it
 * from every page's <head>; the buyer-facing pages switch the link off in
 * (public)/layout.tsx.
 *
 * `id` IS PERMANENT. Browsers key an installed app by it, so changing it later
 * turns every existing install into a stranger to the new manifest. It is set
 * explicitly, rather than left to default to start_url, so the landing page
 * can move without that happening.
 *
 * In the seller's language (the same cookie every page reads), so the
 * shortcuts and description match the app they open.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const locale = await getLocale();
  const t = await getTranslations("Dashboard.metadata.app");
  const nav = await getTranslations("Nav.main");

  return {
    id: "/",
    name: BRAND_NAME,
    short_name: BRAND_NAME,
    description: t("description"),
    lang: locale,
    // Signed out, the dashboard's own gate sends this on to sign-in.
    start_url: OVERVIEW_PATH,
    scope: "/",
    display: "standalone",
    background_color: BRAND_SURFACE,
    theme_color: BRAND_SURFACE,
    categories: ["business", "productivity", "shopping"],
    icons: MANIFEST_ICONS.map(({ src, size, purpose }) => ({
      src,
      sizes: `${size}x${size}`,
      type: "image/png",
      purpose,
    })),
    // The long-press / right-click menu on the installed icon.
    shortcuts: [
      {
        name: nav("products.label"),
        description: nav("products.description"),
        url: PRODUCTS_PATH,
      },
      {
        name: nav("storefront.label"),
        description: nav("storefront.description"),
        url: STOREFRONT_LIST_PATH,
      },
      {
        name: nav("analytics.label"),
        description: nav("analytics.description"),
        url: ANALYTICS_PATH,
      },
      {
        name: nav("settings.label"),
        description: nav("settings.description"),
        url: SETTINGS_PATH,
      },
    ],
  };
}
