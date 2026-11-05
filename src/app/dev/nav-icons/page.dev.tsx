import { notFound } from "next/navigation";
import { NavIconsGallery } from "./NavIconsGallery";

// Living reference for the animated sidebar nav icons: every icon at rail
// size and at an inspection size, wired to the same hover trigger the real
// sidebar uses. Dev-only: the route 404s in production builds.

export const metadata = { title: "Nav icons dev gallery" };

export default function NavIconsDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <NavIconsGallery />;
}
