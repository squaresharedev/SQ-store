import { notFound } from "next/navigation";
import { DiscountsGallery } from "./DiscountsGallery";
import { buildDiscountFixtures } from "./fixtures";

// A discount, everywhere it is drawn, with no sign-in and no database: the
// seller's list (components/discounts/DiscountRow, one ticket per state), then
// what a buyer sees of it on the product page (the sale ticket under the
// price) and at checkout (an applied code). The fixtures are dated from the
// request, so each state is true whenever the page is opened. Dev-only: the
// route 404s in production builds.

export const metadata = { title: "Discounts: dev gallery" };

export default function DiscountsDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const now = new Date();
  return <DiscountsGallery fixtures={buildDiscountFixtures(now)} now={now.toISOString()} />;
}
