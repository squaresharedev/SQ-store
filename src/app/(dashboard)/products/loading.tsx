import { CardGridSkeleton } from "@/components/ui/CardGridSkeleton";

/** Route-level loading state while the server queries the product page. */
export default function ProductsLoading() {
  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground md:text-3xl">
          Products
        </h1>
        <p className="mt-1 font-inter text-sm text-muted-foreground">
          Manage the products you sell through your store and embeds.
        </p>
      </div>
      <CardGridSkeleton label="products" />
    </main>
  );
}
