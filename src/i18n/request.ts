import { headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { readLocaleCookie } from "./cookie";
import { DEFAULT_LOCALE, negotiateLocale } from "./locales";
import { loadMessages } from "./messages";

/**
 * Per-request i18n config, wired in by the next-intl plugin in next.config.ts.
 *
 * NO LOCALE ROUTING, deliberately. next-intl's routed setup needs middleware,
 * and this stack cannot ship any: Next 16 runs Proxy on the Node runtime only,
 * and @opennextjs/cloudflare refuses to build Node middleware. So the locale is
 * resolved here, per request, from:
 *
 *   1. the ss_locale cookie, an explicit choice made on this browser (or
 *      copied from the account at sign-in);
 *   2. the browser's Accept-Language, so a Czech browser reaches a Czech login
 *      page before anyone has chosen anything;
 *   3. English.
 *
 * No database read: this runs on every request, including the public product
 * page. The account's saved choice reaches the cookie at sign-in instead
 * (src/i18n/sign-in.ts).
 */
export default getRequestConfig(async () => {
  const locale =
    (await readLocaleCookie()) ??
    negotiateLocale((await headers()).get("accept-language")) ??
    DEFAULT_LOCALE;

  return {
    locale,
    messages: await loadMessages(locale),
  };
});
