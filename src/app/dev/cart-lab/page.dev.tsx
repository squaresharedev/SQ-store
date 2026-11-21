import { notFound } from "next/navigation";
import { LabLoader } from "./LabLoader";

// The cart lab: the cart's look (components/cart/cart-look.ts) and the
// seller's cart options, tuned live over real cart components and fixed
// carts. No account and no database. Dev-only: *.dev.tsx is left out of
// production builds, and the route 404s there regardless.

export const metadata = { title: "Cart lab: dev" };

export default function CartLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <LabLoader />;
}
