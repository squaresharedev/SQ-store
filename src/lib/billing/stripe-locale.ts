import type { Locale } from "@/i18n/locales";

/**
 * The Stripe locale for an app locale, for Checkout, the Customer Portal and
 * the customer's emails. Stripe knows every language this app ships in; only
 * European Portuguese is spelled differently ("pt" there, "pt-PT" here).
 */
export function toStripeLocale(locale: Locale): string {
  return locale === "pt-PT" ? "pt" : locale;
}
