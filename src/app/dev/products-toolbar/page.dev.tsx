import { notFound } from "next/navigation";
import { ProductsToolbarHarness } from "./ProductsToolbarHarness";

// The products page's header and toolbar (components/products/ProductsBrowser)
// over fixture products, so its phone, tablet and desktop arrangements can be
// seen at a real viewport without signing in. `?status=draft` or `?sort=priceHigh`
// shows the filtered state, `?viewer=1` a member who cannot edit, `?empty=1` a
// store with no products, `?rail=1` the dashboard rail's room beside it from md
// up (the real page sits beside the rail). Dev-only: the route 404s in
// production builds.

export const metadata = { title: "Products toolbar: dev" };

type SearchParams = { [key: string]: string | string[] | undefined };

export default async function ProductsToolbarDevPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const one = (key: string) => (Array.isArray(params[key]) ? params[key][0] : params[key]);
  return (
    <ProductsToolbarHarness
      status={one("status") ?? null}
      sort={one("sort") ?? null}
      viewer={one("viewer") === "1"}
      empty={one("empty") === "1"}
      rail={one("rail") === "1"}
    />
  );
}
