import { notFound } from "next/navigation";
import { ProductCardsGallery } from "./ProductCardsGallery";

// Living reference for the product card (components/products/ProductCard):
// every state a seller meets, from fixtures, at the real column widths. Dev-only:
// the route 404s in production builds.

export const metadata = { title: "Product card: dev gallery" };

export default function ProductCardsDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ProductCardsGallery />;
}
