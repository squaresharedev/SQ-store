import type { ReactNode } from "react";
import { ScopedIntlProvider } from "@/i18n/ScopedIntlProvider";

/**
 * Chrome for the storefront EDITOR only: /storefront/[id] and the sample at
 * /storefront/sample, both the full-screen designer with no dashboard shell.
 *
 * It exists to ship the designer its own copy and nothing more. The list, one
 * level over in (list), wears the dashboard and so carries that copy as well
 * (scope `storefrontList`); the editor does not, which keeps Settings, Orders
 * and the rest of the dashboard's wording out of the editor's page
 * (src/i18n/scopes.ts). Auth is the section's, in storefront/layout.tsx.
 */
export default function StorefrontDesignerLayout({ children }: { children: ReactNode }) {
  return <ScopedIntlProvider scope="designer">{children}</ScopedIntlProvider>;
}
