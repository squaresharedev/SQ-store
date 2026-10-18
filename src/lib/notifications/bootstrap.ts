// What the notification bell needs to start, and how the browser asks for it.
// Client-safe: the hook (./useNotifications.ts) imports this; the answer is
// built on the server by app/api/notifications/bootstrap.
//
// WHY A PLAIN REQUEST AND NOT A SERVER ACTION. The bell starts on every full
// page load, and it used to start with two server actions. Next runs server
// actions and client navigations through one queue: a navigation that began
// while one of the bell's actions was in flight was answered by the server and
// then never committed. The address did not change, and the link or filter the
// seller had just pressed did nothing until they pressed it again. The window
// is short on a fast server and long on a cold one, which is exactly when
// someone clicks early. A fetch is outside that queue, so nothing the bell does
// while starting up can hold a navigation back.

import type { NotificationSnapshot } from "@/lib/notifications/types";

/** Where the bell's start-up data is served. */
export const NOTIFICATIONS_BOOTSTRAP_API_PATH = "/api/notifications/bootstrap";

export type BellBootstrap = {
  /** The recent list and the unread count, or null when signed out. */
  snapshot: NotificationSnapshot | null;
  /** The user's own short-lived access token, for the Realtime subscription
   *  (the session cookie is HttpOnly, so the browser has none of its own). */
  token: string | null;
};

const NOTHING: BellBootstrap = { snapshot: null, token: null };

/**
 * Ask the server for the bell's start-up data. Never throws: a failed request
 * is the same answer as being signed out, and the bell shows its static error
 * state rather than breaking the page it sits on.
 */
export async function loadBellBootstrap(): Promise<BellBootstrap> {
  try {
    const response = await fetch(NOTIFICATIONS_BOOTSTRAP_API_PATH, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return NOTHING;
    const body = (await response.json()) as Partial<BellBootstrap>;
    return { snapshot: body.snapshot ?? null, token: typeof body.token === "string" ? body.token : null };
  } catch {
    return NOTHING;
  }
}
