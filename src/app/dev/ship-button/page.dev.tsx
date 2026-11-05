import { notFound } from "next/navigation";
import { ShipButtonGallery } from "./ShipButtonGallery";

// Living reference for the "mark shipped" moment (components/orders/ShipConfirmButton):
// the truck revving while a request is out, driving across into the success wash,
// and parking again on a refusal, on both surfaces. Dev-only: the route 404s in
// production builds.

export const metadata = { title: "Mark shipped: dev gallery" };

export default function ShipButtonDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ShipButtonGallery />;
}
