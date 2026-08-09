import { notFound } from "next/navigation";
import { ToastGallery } from "./ToastGallery";

// Living reference for the toast system (components/ui/Toast.tsx): every tone,
// the tone marks at every size, real copy from real call sites, and the states
// that only show up in the wild — an overflowing stack, a repeated message, a
// sentence with no end. Dev-only — the route 404s in production builds.

export const metadata = { title: "Toasts — dev gallery" };

export default function ToastDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ToastGallery />;
}
