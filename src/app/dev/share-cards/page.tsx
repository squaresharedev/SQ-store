import { notFound } from "next/navigation";
import { SHARE_CARD_FIXTURES } from "./fixtures";
import { ShareCardsGallery } from "./ShareCardsGallery";
import { sellerShareProducts } from "./seller-products";

// Living reference for the product share cards (components/share-card): every
// template in every format, on fixtures and, when signed in, on the seller's
// own newest products. Dev-only: the route 404s in production builds.

export const metadata = { title: "Share cards: dev gallery" };

export default async function ShareCardsDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const mine = await sellerShareProducts();
  return <ShareCardsGallery products={[...mine, ...SHARE_CARD_FIXTURES]} />;
}
