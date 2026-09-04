import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { Product, ProductDetail } from "@/types/product";
import type { ShippingChoices } from "@/lib/storefront/queries";
import { iconNudgeLeftClass } from "@/components/ui/control-styles";
import { ProductForm } from "./ProductForm";

// Shared page shell for the create and edit routes: back link, heading, and the
// form. Presentational and server-safe; only ProductForm is a client component.
export function ProductFormView({
  title,
  subtitle,
  product,
  shippingChoices,
}: {
  title: string;
  subtitle: string;
  /** The edit route passes the full detail row; a bare Product still works. */
  product?: Product | ProductDetail;
  /** The store's shipping terms and profiles, so the form can show what this
   *  product inherits instead of asking the seller to write it again. */
  shippingChoices?: ShippingChoices;
}) {
  return (
    // Widens only at `lg`, and only by exactly the room the section index in
    // ProductForm needs. Below that the reading column stays where it was —
    // a form that got wider on a medium screen would be a worse form, not a
    // better one.
    <main className="mx-auto max-w-3xl px-6 py-8 lg:max-w-5xl">
      <Link
        href="/products"
        className="group/btn inline-flex items-center gap-1.5 font-inter text-sm text-muted-foreground transition-colors duration-base ease-standard hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
      >
        <ArrowLeft
          className={`size-4 ${iconNudgeLeftClass}`}
          strokeWidth={2}
          aria-hidden="true"
        />
        Products
      </Link>

      {/* The subtitle is gone. "Add a product to sell through your store and
          embeds" under a heading that says "New product" is a sentence nobody
          needed twice; the prop stays so the routes keep their copy in one
          place and it can be read by anything that wants it. */}
      <h1
        className="mb-8 mt-4 text-2xl font-semibold text-foreground md:text-3xl"
        title={subtitle}
      >
        {title}
      </h1>

      <ProductForm product={product} shippingChoices={shippingChoices} />
    </main>
  );
}
