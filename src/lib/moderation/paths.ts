/** Where the moderation routes live, in one place. Pure strings, safe on the
 *  server and the client. The admin panel's lib/moderation/store-links.ts
 *  mirrors these to link sellers here from its emails. */

/** The statement of reasons for one decision, as a PDF download. */
export function moderationStatementPath(decisionId: string): string {
  return `/api/moderation/decisions/${decisionId}/statement`;
}

/** The DOM id of one item's takedown banner, so a flagged section's "See why"
 *  can land on it. Per item: the storefront list can show several. */
export function moderationNoticeId(targetId: string): string {
  return `moderation-notice-${targetId}`;
}
