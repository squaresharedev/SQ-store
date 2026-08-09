import Link from "next/link";
import { buttonClassName } from "@/components/ui/button";

/**
 * App-styled 404 for every notFound() call (bad product id, bad storefront id,
 * unknown route). Without this file Next.js renders its own unstyled default,
 * which has no navigation back into the app, so a mistyped or stale URL left
 * the user with nothing but the browser Back button.
 *
 * Mirrors error.tsx's layout so the two failure surfaces read as one family.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted px-6 py-5">
      <div className="w-full max-w-md border border-border bg-background px-6 py-7 shadow-lg sm:px-7">
        <h1 className="font-display text-lg font-black tracking-tight text-foreground">
          Page not found
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page doesn&apos;t exist, or the thing it pointed at was deleted.
          The link may be stale, but your account and data are fine.
        </p>
        <nav className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link
            href="/dashboard"
            className={buttonClassName("primary", "py-2")}
          >
            Back to dashboard
          </Link>
          <Link
            href="/products"
            className="text-sm font-medium text-foreground underline decoration-border underline-offset-4 transition-colors duration-base ease-standard hover:decoration-foreground motion-reduce:transition-none"
          >
            Products
          </Link>
          <Link
            href="/storefront"
            className="text-sm font-medium text-foreground underline decoration-border underline-offset-4 transition-colors duration-base ease-standard hover:decoration-foreground motion-reduce:transition-none"
          >
            Storefronts
          </Link>
        </nav>
      </div>
    </main>
  );
}
