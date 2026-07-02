import Link from "next/link";
import { Package, Plus } from "lucide-react";
import { primaryButtonClass } from "./control-styles";

// First screen a new seller is likely to see, so it explains the next step and
// gives one clear call to action (styles.md: calm, direct, no fluff).
export function ProductEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-[0.5rem] border border-dashed border-border bg-background px-6 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Package
          className="size-6 text-muted-foreground"
          strokeWidth={1.5}
          aria-hidden="true"
        />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-foreground">
        No products yet
      </h2>
      <p className="mt-1 max-w-sm font-inter text-sm text-muted-foreground">
        Add your first product to start selling through your store and embeds.
        You can save it as a draft and publish when you are ready.
      </p>
      <Link href="/products/new" className={`mt-6 ${primaryButtonClass}`}>
        <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
        Add product
      </Link>
    </div>
  );
}
