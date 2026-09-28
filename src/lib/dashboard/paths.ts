/** Where the dashboard's top-level sections live, in one place so a route that
 *  moves is a one-line change. Pure strings: safe on server and client.
 *  Products and storefronts own theirs (lib/products/paths.ts,
 *  lib/storefront/paths.ts). */

/** The Overview page. The bare "/" only redirects here. */
export const OVERVIEW_PATH = "/dashboard";

export const ORDERS_PATH = "/orders";

export const ANALYTICS_PATH = "/analytics";

export const PAYMENTS_PATH = "/payments";

/** The settings area; each section is a sub-path of it. */
export const SETTINGS_PATH = "/settings";
