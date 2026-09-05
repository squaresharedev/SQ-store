"use client";

import { useRouter } from "next/navigation";

/**
 * The buyer-facing page for every way a product can be unavailable: unknown
 * ids, a draft, a product not placed on this storefront, or product pages
 * switched off entirely. All failures look the same — nothing is enumerable.
 *
 * No internal error slug (BUY-04): `err_product_unavailable` is an
 * implementation detail that tells a buyer nothing and tells an attacker which
 * surface to probe. No BrandFooter: marketing links belong on squareshare.eu,
 * not on a buyer's dead-end 404.
 *
 * The "Go back" button uses history.back() — the same "where you were" that
 * the browser's own back arrow uses — so a buyer who followed a tile from a
 * storefront goes back to that storefront rather than the browser start page.
 */
export default function ProductNotFound() {
  const router = useRouter();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-12 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">
        This product isn&apos;t available
      </h1>
      <p className="max-w-sm text-sm leading-relaxed opacity-70">
        It may have been removed, or the link you followed is out of date. Head
        back to the shop to see what&apos;s on offer now.
      </p>
      <button
        onClick={() => router.back()}
        className="rounded-lg border border-current px-5 py-2.5 text-sm font-medium opacity-75 hover:opacity-100"
      >
        Go back
      </button>
    </div>
  );
}
