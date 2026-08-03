import { notFound } from "next/navigation";
import { PreviewGallery } from "./PreviewGallery";

// Living reference for the storefront card's preview: every board shape the
// schema permits, in the card's real box. Dev-only — 404s in production.

export const metadata = { title: "Storefront preview — dev gallery" };

export default function StorefrontPreviewDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <PreviewGallery />;
}
