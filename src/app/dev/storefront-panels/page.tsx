import { notFound } from "next/navigation";
import { PanelsGallery } from "./PanelsGallery";

// Living reference for the designer's side-panel navigation: the design panel's
// group menu and submenus, plus each block inspector, against a fixture theme.
// Lets the panels be checked without a seeded store. Dev-only — the route 404s
// in production builds.

export const metadata = { title: "Storefront panels — dev gallery" };

export default function StorefrontPanelsDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <PanelsGallery />;
}
