import { notFound } from "next/navigation";
import { ProductFormView } from "@/components/products/ProductFormView";
import type { ProductDetail } from "@/types/product";
import type { ShippingChoices } from "@/lib/storefront/queries";
import { EMPTY_SHIPPING_POLICY, SHIPPING_SETTINGS_HREF } from "@/types/shipping-policy";

// Living reference for the product editor (components/products/ProductForm):
// `?mode=edit` opens a filled-in product, anything else a blank new one.
// Dev-only: the route 404s in production builds, and nothing here saves.

export const metadata = { title: "Product form: dev harness" };

const SHIPPING: ShippingChoices = {
  profiles: [{ id: "bulky", name: "Bulky items", dispatch: "Ships in 5–7 days", body: "" }],
  fallback: { dispatch: "Ships in 1–2 working days", body: "Tracked delivery across the EU." },
  editHref: SHIPPING_SETTINGS_HREF,
};

const EDIT_PRODUCT: ProductDetail = {
  id: "00000001-0000-4000-8000-000000000000",
  title: "Wireless headphones",
  description: "Over-ear, 30 hours of battery, folds flat into its case.",
  price: 129,
  currency: "EUR",
  status: "active",
  imageUrl: "/sample-storefront/headphones.webp",
  digitalFileName: null,
  trackStock: true,
  stockQuantity: 14,
  lowStockThreshold: 5,
  maxPerOrder: 5,
  gallery: [],
  optionGroups: [],
  details: {},
  documents: [],
  purchaseUrl: null,
  shippingProfileId: null,
};

export default async function ProductFormDevPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { mode } = await searchParams;
  const editing = mode === "edit";
  return (
    <ProductFormView
      title={editing ? EDIT_PRODUCT.title : "New product"}
      subtitle=""
      product={editing ? EDIT_PRODUCT : undefined}
      shippingChoices={SHIPPING}
      shippingPolicy={EMPTY_SHIPPING_POLICY}
    />
  );
}
