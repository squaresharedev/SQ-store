import { createTranslator } from "next-intl";
import { loadMessages } from "./messages";
import type { Locale } from "./locales";
import type { MessageKey, MessageValues } from "./types";

/** Resolves a full message key in one fixed language. */
export type Translate = (key: MessageKey, values?: MessageValues) => string;

/**
 * A translator for an EXPLICIT language, for text whose reader is not the
 * person whose request is running: mail about an order, written while a
 * payment is being recorded or while the SELLER marks it shipped, and read by
 * the seller or the buyer in their own language.
 *
 * Anything addressed to the signed-in reader of the current request should use
 * getTranslations() instead, which already knows their language.
 */
export async function translatorFor(locale: Locale): Promise<Translate> {
  const t = createTranslator({
    locale,
    messages: await loadMessages(locale),
    timeZone: "UTC",
  });
  return (key, values) => t(key, values);
}
