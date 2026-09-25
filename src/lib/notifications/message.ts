import { z } from "zod";
import type { MessageKey } from "@/i18n/types";
import catalogue from "../../../messages/en/notifications.json";

/**
 * A NOTIFICATION IS STORED IN NO LANGUAGE.
 *
 * A row is written once, by the server, and read later by someone whose UI
 * language the writer cannot know (and which can change). So the message goes
 * into `data.message` as keys plus values, and the reader resolves it. The
 * English is still written into the `title` and `body` columns: rows from
 * before this existed have nothing else, and it is what a reader falls back to
 * whenever the stored message cannot be resolved.
 *
 * `data` is read back from the database, so at the render site it is untrusted
 * input: {@link storedNotificationMessage} accepts only real keys inside the
 * Notifications namespace, with plain string or number values.
 */

export type NotificationMessageKey = Extract<MessageKey, `Notifications.${string}`>;

export type NotificationMessageValues = Record<string, string | number>;

export type NotificationMessageRef = {
  key: NotificationMessageKey;
  values?: NotificationMessageValues;
};

/** What a sender passes, and what `data.message` holds. */
export type NotificationMessage = {
  title: NotificationMessageRef;
  body?: NotificationMessageRef;
};

/**
 * Whether a string names a message in the Notifications catalogue. Walked
 * through the catalogue itself rather than checked by prefix, so a key that
 * names a group of messages, or nothing at all, is refused.
 */
export function isNotificationMessageKey(value: string): value is NotificationMessageKey {
  const [namespace, ...path] = value.split(".");
  if (namespace !== "Notifications" || path.length === 0) return false;
  let node: unknown = catalogue;
  for (const segment of path) {
    if (typeof node !== "object" || node === null || !Object.hasOwn(node, segment)) {
      return false;
    }
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === "string";
}

const valuesSchema = z
  .record(
    z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/),
    z.union([z.string().max(500), z.number().finite()]),
  )
  .refine((values) => Object.keys(values).length <= 10);

const refSchema = z.strictObject({
  key: z.custom<NotificationMessageKey>(
    (value) => typeof value === "string" && isNotificationMessageKey(value),
  ),
  values: valuesSchema.optional(),
});

const storedSchema = z.object({
  message: z.strictObject({
    title: refSchema,
    body: refSchema.optional(),
  }),
});

/**
 * The stored message in a notification's `data`, or null when there is none
 * or it is not exactly the shape a sender writes.
 */
export function storedNotificationMessage(data: unknown): NotificationMessage | null {
  const parsed = storedSchema.safeParse(data);
  if (!parsed.success) return null;
  return parsed.data.message;
}
