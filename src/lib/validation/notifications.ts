import { z } from "zod";
import { NOTIFICATION_TYPES } from "@/lib/notifications/types";

/**
 * Notification validation schemas, shared by the server (the real gate — every
 * create + read param re-validates here). `type` is an enum; `title`/`body` are
 * plain text with length caps mirroring the DB CHECK constraints. `data` is a
 * shallow JSON object (deep-linking payload), never executed, only read.
 */

/** JSON object payload for deep-linking (e.g. `{ href: "/settings/team" }`). */
const jsonRecord = z.record(z.string(), z.unknown());

export const createNotificationSchema = z.strictObject({
  userId: z.uuid("A notification needs a valid recipient."),
  type: z.enum(NOTIFICATION_TYPES),
  title: z.string().trim().min(1, "A notification needs a title.").max(200),
  body: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((v) => (v ? v : null)),
  data: jsonRecord.optional().default({}),
});

export type CreateNotificationInput = z.input<typeof createNotificationSchema>;

/** Marking a single notification read: only an id is accepted. */
export const markReadSchema = z.strictObject({
  id: z.uuid("Invalid notification reference."),
});

/** History pagination params (server-clamped). */
export const notificationPageSchema = z.strictObject({
  cursor: z.iso.datetime({ offset: true }).nullable().optional(),
  limit: z.number().int().min(1).max(50).optional().default(20),
});
