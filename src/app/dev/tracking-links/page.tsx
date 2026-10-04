import { notFound } from "next/navigation";
import { TrackingLinksGallery } from "./TrackingLinksGallery";

// Every carrier's tracking link, built by the real builder (lib/orders/carriers.ts)
// from a number you type, so each one can be opened and checked against the
// carrier's own site. Dev-only: the route 404s in production builds.

export const metadata = { title: "Tracking links: dev gallery" };

export default function TrackingLinksDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <TrackingLinksGallery />;
}
