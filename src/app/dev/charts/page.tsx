import { notFound } from "next/navigation";
import { ChartsGallery } from "./ChartsGallery";

// Living reference for the reusable chart kit (components/charts): every
// family and subtype with representative data. Dev-only — the route 404s in
// production builds.

export const metadata = { title: "Chart kit — dev gallery" };

export default function ChartsDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ChartsGallery />;
}
