import type { MessageKeys, NestedKeyOf } from "next-intl";
import type { Messages } from "./messages";

/** Any message in the catalogue, by its full dotted path ("Errors.sessionExpired.message"). */
export type MessageKey = MessageKeys<Messages, NestedKeyOf<Messages>>;

/** ICU argument values a message can be formatted with. */
export type MessageValues = Record<string, string | number | Date>;

/**
 * A message to show, not yet in any language.
 *
 * Pure modules shared by client and server (server action results, validation,
 * copy tables in src/lib) cannot call `useTranslations`, and must not return
 * English prose either: whatever they return is rendered in the READER'S
 * language, which only the render site knows. So they return one of these and
 * the render site resolves it:
 *
 *   const t = useTranslations();              // no namespace: full keys
 *   t(ref.key, ref.values);
 *
 * `values` carries data, never copy. A seller's product title goes in as a
 * value; a translated word never does.
 */
export type MessageRef = {
  key: MessageKey;
  values?: MessageValues;
};

/** Build a MessageRef. Exists so call sites read as intent, not object literals. */
export function msg(key: MessageKey, values?: MessageValues): MessageRef {
  return values ? { key, values } : { key };
}
