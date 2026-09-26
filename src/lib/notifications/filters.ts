import { NOTIFICATION_TYPES, type NotificationType } from "@/lib/notifications/types";

/**
 * What the notification history is narrowed to. Lives in the URL
 * (`?type=team&status=unread`) so a filtered view survives a reload and
 * back/forward, and is parsed from there on the server, where the filtering
 * actually happens: the history is keyset-paginated, so narrowing only the
 * rows already on screen would hide matches that sit on a later page.
 *
 * Isomorphic: the page parses it, the client builds links from it, and the
 * "load more" action re-validates it.
 */
export type NotificationFilter = {
  /** One category, or null for every category. */
  type: NotificationType | null;
  /** Only rows the reader has not opened yet. */
  unread: boolean;
};

export const NO_NOTIFICATION_FILTER: NotificationFilter = { type: null, unread: false };

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function isNotificationType(value: unknown): value is NotificationType {
  return typeof value === "string" && (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

/** Whitelist-parse the URL. Anything unrecognised is dropped, never echoed. */
export function parseNotificationFilter(params: SearchParams): NotificationFilter {
  const type = first(params.type);
  return {
    type: isNotificationType(type) ? type : null,
    unread: first(params.status) === "unread",
  };
}

/** The query string for a filter: "" for the unfiltered view. */
export function notificationFilterQuery(filter: NotificationFilter): string {
  const params = new URLSearchParams();
  if (filter.type) params.set("type", filter.type);
  if (filter.unread) params.set("status", "unread");
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function isFiltered(filter: NotificationFilter): boolean {
  return filter.type !== null || filter.unread;
}

/** Per-category counts behind the filter bar. */
export type NotificationFacets = {
  /** Categories the reader has anything in, with how many are unread. */
  byType: Partial<Record<NotificationType, { total: number; unread: number }>>;
  /** Unread across every category. */
  unread: number;
};
