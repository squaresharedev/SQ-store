"use client";

import * as React from "react";
import {
  useNotifications,
  type UseNotifications,
} from "@/lib/notifications/useNotifications";

/**
 * Runs the realtime notifications hook ONCE and shares it via context, so the
 * bell can render in multiple places (desktop top bar + mobile header) while a
 * single subscription and a single unread count back them all. This is the
 * "single source of truth" for client notification state.
 */
const NotificationsContext = React.createContext<UseNotifications | null>(null);

export function NotificationsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const value = useNotifications();
  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

/**
 * The shared state when a provider is mounted, else null. For surfaces that
 * keep their own list (the history page) but should still tell the bell when
 * they change something, without the realtime round trip.
 */
export function useOptionalNotificationsContext(): UseNotifications | null {
  return React.useContext(NotificationsContext);
}

export function useNotificationsContext(): UseNotifications {
  const ctx = React.useContext(NotificationsContext);
  if (!ctx) {
    throw new Error(
      "useNotificationsContext must be used within <NotificationsProvider>.",
    );
  }
  return ctx;
}
