import { CardGridSkeleton } from "@/components/ui/CardGridSkeleton";

/** Route-level loading state while the server queries storefronts. */
export default function StorefrontsLoading() {
  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground md:text-3xl">
          Storefronts
        </h1>
        <p className="mt-1 font-inter text-sm text-muted-foreground">
          Each storefront is its own grid and theme. Create as many as you need,
          then open one to edit it.
        </p>
      </div>
      <CardGridSkeleton label="storefronts" cards={4} />
    </main>
  );
}
