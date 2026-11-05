import { notFound } from "next/navigation";
import { PickersGallery } from "./PickersGallery";

// Living reference for the shared ColorPicker (components/ui/ColorPicker):
// every variant it ships in, plus the side-panel layout it renders in. Dev-only
// — the route 404s in production builds.

export const metadata = { title: "Pickers — dev gallery" };

export default function PickersDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <PickersGallery />;
}
