import type { ReactNode } from "react";
import { ScopedIntlProvider } from "@/i18n/ScopedIntlProvider";

/**
 * Orders section scope. Adds the full Orders namespace for the order list,
 * detail panel, fulfilment, and tracking pages.
 */
export default function OrdersSectionLayout({ children }: { children: ReactNode }) {
  return <ScopedIntlProvider scope="orders">{children}</ScopedIntlProvider>;
}
