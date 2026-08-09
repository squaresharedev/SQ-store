import { pageShellClass } from "@/components/ui/surface-styles";
import { CardGridSkeleton } from "@/components/ui/CardGridSkeleton";

/** Route-level loading state while the server queries the product page. */
export default function ProductsLoading() {
  return (
    <main className={pageShellClass}>
      <div className="mb-6">
        {/* Same size as the real header (products/page.tsx) so the title does
            not resize when the data lands. */}
        <h1 className="text-3xl font-semibold text-foreground md:text-4xl">
          Products
        </h1>
      </div>
      <CardGridSkeleton label="products" />
    </main>
  );
}
