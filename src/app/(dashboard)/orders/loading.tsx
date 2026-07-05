import { OrdersSkeleton } from "@/components/orders/OrdersSkeleton";

/** Route-level loading state while the server queries orders. */
export default function OrdersLoading() {
  return (
    <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground md:text-3xl">
          Orders
        </h1>
        <p className="mt-1 font-inter text-sm text-muted-foreground">
          Every sale across your embed and the marketplace.
        </p>
      </div>
      <OrdersSkeleton />
    </main>
  );
}
