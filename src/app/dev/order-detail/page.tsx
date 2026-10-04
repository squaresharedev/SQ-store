import { notFound } from "next/navigation";
import { OrderDetailGallery } from "./OrderDetailGallery";

// Living reference for the order panel (components/orders/OrderDetail): every
// state a seller meets, from fixtures, at the panel's real phone width and in
// both themes. Dev-only: the route 404s in production builds.

export const metadata = { title: "Order panel: dev gallery" };

export default function OrderDetailDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <OrderDetailGallery />;
}
