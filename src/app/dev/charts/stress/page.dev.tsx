import { notFound } from "next/navigation";
import { StressGallery } from "./StressGallery";

// The analytics charts on the worst data a store can produce: one sale, a
// billion, nothing, a three-year range, a product called a paragraph. The
// specimens at /dev/charts show each chart at its best; this page is where
// each is shown at its limits, and tests/e2e/85-chart-stress.spec.ts walks it
// at every screen size. Dev-only: the route 404s in production builds.

export const metadata = { title: "Chart kit — stress cases" };

export default function ChartStressPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <StressGallery />;
}
