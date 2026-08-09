import { pageShellClass } from "@/components/ui/surface-styles";
import { PageHeader } from "@/components/layout/PageHeader";
import { CardGridSkeleton } from "@/components/ui/CardGridSkeleton";

/** Route-level loading state while the server queries storefronts. */
export default function StorefrontsLoading() {
  return (
    <main className={pageShellClass}>
      <PageHeader
        className="mb-6"
        title="Storefronts"
        subtitle="Each storefront is its own grid and theme. Create as many as you need, then open one to edit it."
      />
      <CardGridSkeleton label="storefronts" cards={4} />
    </main>
  );
}
