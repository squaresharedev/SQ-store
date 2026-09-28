"use client";

import { DEFAULT_GADGET, PRODUCT_GADGETS, ProductEmptyState, type ProductGadget } from "@/components/products/ProductEmptyState";
import { pageShellClass } from "@/components/ui/surface-styles";

const GADGETS = Object.keys(PRODUCT_GADGETS) as ProductGadget[];

function Option({ gadget }: { gadget: ProductGadget }) {
  const info = PRODUCT_GADGETS[gadget];
  return (
    <section data-fixture={gadget} className="space-y-3">
      <h2 className="font-inter text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {info.label} <span className="normal-case text-muted-foreground/70">({info.source})</span>
      </h2>
      <ProductEmptyState canWrite gadget={gadget} />
    </section>
  );
}

// A pick-one gallery: every gadget PRODUCT_GADGETS knows about, paired with
// the same t-shirt, rendered through the real ProductEmptyState so what's
// shown here is exactly what shipping it would look like. Change
// DEFAULT_GADGET in ProductEmptyState.tsx once one is chosen.
export function ProductEmptyGallery() {
  return (
    <main className={`${pageShellClass} space-y-12`}>
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Product empty state: gadget options</h1>
        <p className="mt-1 max-w-2xl font-inter text-sm text-muted-foreground">
          Same t-shirt, different gadget on the right. Pick one and set it as{" "}
          <code className="rounded-sm bg-muted px-1 py-0.5 text-xs">DEFAULT_GADGET</code> in ProductEmptyState.tsx.
        </p>
      </div>
      {GADGETS.map((gadget) => (
        <Option key={gadget} gadget={gadget} />
      ))}
      <SidebarNarrowedCheck />
    </main>
  );
}

/**
 * The real (dashboard) page reserves a 256px sidebar from `md` up
 * (DashboardShell's `md:pl-64`), which this dev route otherwise never shows:
 * bare, a wide product read as fitting right up to a viewport width where the
 * real page — narrower by that whole sidebar — had already started clipping
 * it against the frame's `overflow-hidden`. This fixture reproduces that
 * offset AT THE SAME `md:` BREAKPOINT (not unconditionally — an early version
 * of this fixture applied `pl-64` at every width, which invents an overflow
 * below 768px that no real page has, since the sidebar collapses there too)
 * so a size regression shows up here first, without needing a session. Check
 * it across roughly 700–1100px: the room right around where the sidebar
 * appears is the tightest the real shell ever gets.
 */
function SidebarNarrowedCheck() {
  return (
    <section data-fixture="sidebar-narrowed" className="space-y-3">
      <h2 className="font-inter text-xs font-medium uppercase tracking-wide text-muted-foreground">
        With the dashboard&rsquo;s sidebar offset (md:pl-64) — narrow the window across ~700&ndash;1100px
      </h2>
      <div className="border-l-2 border-dashed border-border md:pl-64">
        <ProductEmptyState canWrite gadget={DEFAULT_GADGET} />
      </div>
    </section>
  );
}
