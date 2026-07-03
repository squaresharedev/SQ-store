import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { Product } from "@/types/product";
import { ProductForm } from "./ProductForm";

// Shared page shell for the create and edit routes: back link, heading, and the
// form. Presentational and server-safe; only ProductForm is a client component.
export function ProductFormView({
  title,
  subtitle,
  product,
}: {
  title: string;
  subtitle: string;
  product?: Product;
}) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <Link
        href="/products"
        className="inline-flex items-center gap-1.5 font-inter text-sm text-muted-foreground transition-colors duration-180 ease-in-out hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
      >
        <ArrowLeft className="size-4" strokeWidth={2} aria-hidden="true" />
        Products
      </Link>

      <div className="mb-8 mt-4">
        <h1 className="text-2xl font-semibold text-foreground md:text-3xl">
          {title}
        </h1>
        <p className="mt-1 font-inter text-sm text-muted-foreground">
          {subtitle}
        </p>
      </div>

      <ProductForm product={product} />
    </main>
  );
}
