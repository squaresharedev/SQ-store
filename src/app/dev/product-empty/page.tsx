import { notFound } from "next/navigation";
import { ProductEmptyGallery } from "./ProductEmptyGallery";

// Every gadget candidate for the empty products list's right-hand slot, side
// by side, so the team can pick one without editing code to preview each.
// See ProductEmptyState.tsx (PRODUCT_GADGETS) for the shipped default and how
// this page's `gadget` prop plugs into the same component real callers use.
// No account and no database. Dev-only: the route 404s in production builds.

export const metadata = { title: "Product empty state: gadget options" };

export default function ProductEmptyDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ProductEmptyGallery />;
}
