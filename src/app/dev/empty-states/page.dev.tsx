import { notFound } from "next/navigation";
import { EmptyStatesGallery } from "./EmptyStatesGallery";

// Living reference for the empty products and storefront lists: the real
// ProductEmptyState and the real StorefrontsList with nothing in them, as a
// writer, beside the sample storefront, and read-only. No account and no
// database. Dev-only: the route 404s in production builds.

export const metadata = { title: "Empty states: dev gallery" };

export default function EmptyStatesDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <EmptyStatesGallery />;
}
