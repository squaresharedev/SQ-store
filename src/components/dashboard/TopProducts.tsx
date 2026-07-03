import type { TopProduct } from "@/lib/dashboard/queries";
import { formatMoney } from "@/lib/dashboard/format";
import { ModuleCard, ModuleEmptyText } from "./ModuleCard";

/** Top ~5 products by paid revenue (title snapshots from the orders). */
export function TopProducts({ products }: { products: TopProduct[] }) {
  return (
    <ModuleCard title="Top products">
      {products.length === 0 ? (
        <ModuleEmptyText>
          Once you have sales, your best sellers rank here.
        </ModuleEmptyText>
      ) : (
        <ol className="divide-y divide-border">
          {products.map((product, index) => (
            <li
              key={product.title}
              className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              <span className="w-4 shrink-0 text-center font-inter text-xs text-muted-foreground">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {product.title}
                </p>
                <p className="font-inter text-xs text-muted-foreground">
                  {product.sales} sale{product.sales === 1 ? "" : "s"}
                </p>
              </div>
              <span className="shrink-0 font-inter text-sm font-medium text-foreground">
                {formatMoney(product.revenue)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </ModuleCard>
  );
}
