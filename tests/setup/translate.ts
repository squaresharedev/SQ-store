import { createTranslator } from "next-intl";
import type { MessageKey, MessageRef, MessageValues } from "@/i18n/types";
import messages from "../../messages/en";

const t = createTranslator({ locale: "en", messages, timeZone: "UTC" });

/**
 * The English a user would see for a message key or MessageRef.
 *
 * For tests of code that returns MessageRefs (server actions, validation, copy
 * tables): assert on the resolved text, not the key, so a spec still checks
 * what a reader is shown and survives a key being renamed.
 */
export function english(ref: MessageRef | MessageKey, values?: MessageValues): string {
  return typeof ref === "string" ? t(ref, values) : t(ref.key, ref.values);
}
