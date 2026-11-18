"use client";

import * as React from "react";
import { Flag } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ProductPageReportScopes } from "@/types/product-page";

// ReportDialogPanel is loaded only after the trigger is clicked (open becomes
// true). This keeps report-constants.ts, the lucide icons, and the modal form
// out of the buyer page's initial bundle -- those are ~40 KB gz that land on
// every product page, embed frame and checkout, all of which show this trigger
// but almost never open it.
//
// React.lazy rather than next/dynamic: the dynamic wrapper ships ~1.6 KB gz of
// Next.js framework code with every product page; lazy + Suspense is handled
// by React itself with no overhead.
const LazyReportDialogPanel = React.lazy(
  () => import("./ReportDialogPanel").then((m) => ({ default: m.ReportDialogPanel })),
);

const NO_WIDER_SCOPES: ProductPageReportScopes = { storefront: false, seller: false };

/**
 * "Report this product" and the dialog behind it.
 *
 * WHERE IT SITS AND WHY IT IS QUIET. In the footer, at the muted size the rest
 * of that row uses. A report link is not a call to action: it has to be
 * findable by someone who came looking for it and invisible to someone who did
 * not. Making it prominent on a seller's page would be a permanent accusation
 * printed under every honest listing.
 *
 * HOW THE SPLIT WORKS. This component owns the trigger button and the open
 * state. The dialog body (Modal + form + all state) lives in ReportDialogPanel
 * and is loaded lazily via next/dynamic so it never reaches the initial bundle.
 * onPointerEnter and onFocus on the trigger start the prefetch early enough
 * that the first open feels instant.
 *
 * INERT IN THE EDITOR (`preview`). The seller previewing their own page gets
 * the link rendered, so they can see what a buyer sees, and clicking it does
 * nothing. A live dialog there would let someone report their own product and
 * would put a stranger's accusation vocabulary in the middle of their design
 * surface.
 */
export function ReportDialog({
  product,
  storefront,
  sellerName,
  scopes = NO_WIDER_SCOPES,
  preview = false,
}: {
  /** The product this page is about. Absent on a storefront's own page, where
   *  the report is about the storefront (or the seller behind it). */
  product?: { id: string; title: string };
  /** The storefront this page hangs off, as its buyers know it. */
  storefront: { id: string; name: string };
  /** Who the buyer is contracting with, as the page names them. */
  sellerName: string;
  /** Which wider targets this seller warrants. */
  scopes?: ProductPageReportScopes;
  /** Editor preview: render the link, do nothing on click. */
  preview?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const t = useTranslations("ProductPage.report");

  // Which target the page is narrowest about: a product page reports a
  // product; a storefront-only page reports the storefront.
  const primary = product ? "product" : "storefront";

  // Whether there is a scope choice to make determines the trigger wording.
  const available = [
    primary,
    ...(product && scopes.storefront ? (["storefront"] as const) : []),
    ...(scopes.seller ? (["seller"] as const) : []),
  ];
  const choosing = available.length > 1;

  // Prefetch the panel chunk on first hover or focus so the first open is
  // instant. The import() is idempotent -- the browser caches the fetch.
  const prefetchPanel = React.useCallback(() => {
    void import("./ReportDialogPanel");
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={preview ? undefined : () => setOpen(true)}
        onPointerEnter={prefetchPanel}
        onFocus={prefetchPanel}
        // Inert rather than hidden in the editor: the seller should see the
        // link exactly where a buyer will.
        aria-disabled={preview || undefined}
        className="inline-flex items-center gap-1.5 underline-offset-2 hover:underline"
        data-report-trigger={primary}
      >
        <Flag aria-hidden="true" className="size-3" />
        {choosing ? t("triggerAny") : t("trigger", { target: primary })}
      </button>

      {open && (
        <React.Suspense fallback={null}>
          <LazyReportDialogPanel
            open={open}
            onClose={() => setOpen(false)}
            product={product}
            storefront={storefront}
            sellerName={sellerName}
            scopes={scopes}
          />
        </React.Suspense>
      )}
    </>
  );
}
