import type { ReactNode } from "react";
import { ScopedIntlProvider } from "@/i18n/ScopedIntlProvider";

/**
 * Notifications section scope. The whole Notifications namespace is already in
 * appChrome (the parent scope), so this scope adds nothing extra. The layout
 * exists to keep the section structure consistent and to satisfy the wiring
 * check that every dashboard section has a scoped layout.
 */
export default function NotificationsSectionLayout({ children }: { children: ReactNode }) {
  return <ScopedIntlProvider scope="notifications">{children}</ScopedIntlProvider>;
}
