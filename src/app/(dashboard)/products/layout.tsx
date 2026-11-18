import type { ReactNode } from "react";
import { ScopedIntlProvider } from "@/i18n/ScopedIntlProvider";

/**
 * Products section scope. Adds Products, ProductPage subtrees (add-ons,
 * reviews, sale, shipping), and Storefront font/style/colour names used by
 * the product form's buyer-page preview.
 */
export default function ProductsSectionLayout({ children }: { children: ReactNode }) {
  return <ScopedIntlProvider scope="products">{children}</ScopedIntlProvider>;
}
