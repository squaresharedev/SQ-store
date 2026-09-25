import type { Locale as AppLocale } from "./locales";
import type { Messages } from "./messages";

/**
 * Types every `t("...")` call against the English catalogue, so a key that does
 * not exist, or a missing ICU argument, fails `tsc` instead of rendering a raw
 * key at runtime.
 */
declare module "next-intl" {
  interface AppConfig {
    Locale: AppLocale;
    Messages: Messages;
  }
}
