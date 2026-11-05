import { notFound } from "next/navigation";
import { TourHarness } from "./TourHarness";

// Living reference for the guided tour (components/onboarding/TourOverlay.tsx):
// the real steps and the real overlay, over fixture pages that render the same
// controls the tour points at, with a fake router whose navigation can be
// instant, slow or lost. No account and no database, so the whole tour can be
// driven on a plain dev server at desktop and phone widths. Dev-only: the route
// 404s in production builds.

export const metadata = { title: "Guided tour: dev harness" };

export default function TourDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <TourHarness />;
}
