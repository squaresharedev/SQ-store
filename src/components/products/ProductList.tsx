"use client";

import { useState } from "react";
import { SearchX } from "lucide-react";
import { emptyStateClass } from "@/components/ui/surface-styles";
import type { Product, ProductSalesSummary } from "@/types/product";
import { deleteProduct } from "@/lib/products/actions";
import { useToast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/modal";
import {
  destructiveButtonClass,
  infoTextClass,
  secondaryButtonClass,
} from "@/components/ui/control-styles";
import type { StorefrontPlacement } from "@/lib/products/queries";
import {
  productPagePath,
  productPageUrl,
} from "@/lib/storefront/product-page-url";
import { ProductCard } from "./ProductCard";
import { ProductEmptyState } from "./ProductEmptyState";

// Client wrapper that owns the visible product set. Delete removes the card
// optimistically, calls the server action, and restores the list if it fails.
// Ordering, filtering, and paging are all SERVER-side now: this component
// renders exactly the page it is given.
export function ProductList({
  products: initial,
  canWrite,
  sales,
  placements = {},
  filtered = false,
  onClearFilters,
}: {
  products: Product[];
  /** Whether the active account's role may edit/delete (hides those controls). */
  canWrite: boolean;
  /** Per-product paid-order rollup + bestseller, fetched server-side. */
  sales: ProductSalesSummary;
  /**
   * Storefronts each product appears on, keyed by product id. Used by the
   * delete dialog (to warn about orphaned blocks) and by the card's copy-link
   * and open affordances.
   */
  placements?: Record<string, StorefrontPlacement[]>;
  /** True when a search or status filter is narrowing the list. Distinguishes
   *  "no products yet" from "nothing matched", which need different words. */
  filtered?: boolean;
  onClearFilters?: () => void;
}) {
  const toast = useToast();
  const [products, setProducts] = useState<Product[]>(initial);
  // The product awaiting confirmation. Deleting takes the product's file and
  // image with it and cannot be undone, so it is never a single click.
  const [pendingDelete, setPendingDelete] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);

  // When there are multiple storefronts for a product and the seller requests
  // a link action, this holds the pending choice until they pick one.
  const [linkTarget, setLinkTarget] = useState<{
    product: Product;
    action: "copy" | "open";
  } | null>(null);

  // After a save the server re-renders with fresh props; adopt them (render-time
  // reset on prop change, same pattern as the Sidebar's route tracking).
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setProducts(initial);
  }

  async function handleConfirmDelete() {
    const target = pendingDelete;
    if (!target || deleting) return;
    setDeleting(true);
    const previous = products;
    // Optimistic: the card goes as soon as the seller confirms, and comes back
    // with an explanation if the server refuses.
    setProducts((current) => current.filter((product) => product.id !== target.id));
    const result = await deleteProduct(target.id);
    setDeleting(false);
    setPendingDelete(null);
    if (!result.ok) {
      setProducts(previous);
      toast.error(result.error.message, { lines: [result.error.fix] });
      return;
    }
    // The card leaving the grid is the only other evidence a delete worked,
    // and on a full page of similar cards that is easy to miss — especially
    // when the confirm modal was covering the one that went.
    toast.success(`"${target.title}" was deleted.`);
  }

  /**
   * Execute a copy or open action for a specific storefront. Copy writes the
   * URL to the clipboard and confirms via toast; open launches a new tab.
   * Both use the canonical URL helper so this and the embed payload always
   * agree on the shape.
   */
  function executeLinkAction(action: "copy" | "open", storefrontId: string, productId: string) {
    if (action === "open") {
      window.open(
        productPageUrl(storefrontId, productId),
        "_blank",
        "noopener",
      );
      return;
    }
    // Copy to clipboard; fail gracefully (the browser may block it in certain
    // contexts even though we are in a secure origin).
    const url = productPageUrl(storefrontId, productId);
    navigator.clipboard.writeText(url).then(
      () => toast.success("Link copied."),
      () =>
        toast.error("Could not copy.", {
          lines: [`The URL is: ${productPagePath(storefrontId, productId)}`],
        }),
    );
  }

  /**
   * Handle a link action from a card. Zero storefronts means the product has
   * no public URL yet; one means act directly; more means the seller must pick.
   */
  function handleLinkAction(product: Product, action: "copy" | "open") {
    const sfList = placements[product.id] ?? [];
    if (sfList.length === 0) {
      toast.info("This product is not on any storefront yet.");
      return;
    }
    if (sfList.length === 1) {
      executeLinkAction(action, sfList[0].id, product.id);
      return;
    }
    setLinkTarget({ product, action });
  }

  if (products.length === 0) {
    // A filtered miss is not an empty store: offering "add your first product"
    // to someone who has 200 products and a typo would be nonsense.
    if (filtered) {
      return (
        <div className={emptyStateClass}>
          <div className="mb-4 flex size-12 items-center justify-center rounded-full border border-border bg-background shadow-xs">
            <SearchX
              className="size-5 text-muted-foreground"
              strokeWidth={2}
              aria-hidden="true"
            />
          </div>
          <p className="text-sm font-medium text-foreground">
            No products match these filters
          </p>
          <p className="mt-1 max-w-xs font-inter text-sm text-muted-foreground">
            Try a different search term, or clear the filters to see everything
            again.
          </p>
          {onClearFilters && (
            <button
              type="button"
              onClick={onClearFilters}
              className={`${secondaryButtonClass} mt-4`}
            >
              Clear filters
            </button>
          )}
        </div>
      );
    }
    return <ProductEmptyState canWrite={canWrite} />;
  }

  // Build the delete dialog description. Name the storefront when the product
  // is placed on one (or more) so the seller knows to clean up the block:
  // deleting the product does not remove it from the grid.
  const deleteStorefronts = pendingDelete
    ? (placements[pendingDelete.id] ?? [])
    : [];
  const deleteStorefrontNote =
    deleteStorefronts.length === 1
      ? ` It is on 1 storefront. The block stays until you remove it.`
      : deleteStorefronts.length > 1
        ? ` It is on ${deleteStorefronts.length} storefronts. The blocks stay until you remove them.`
        : "";

  // Build the storefront chooser description.
  const linkTargetStorefronts = linkTarget
    ? (placements[linkTarget.product.id] ?? [])
    : [];

  return (
    <>
      {/* Four-up from the laptop breakpoint (lg): the smaller card carries it. */}
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {products.map((product) => (
          <li key={product.id}>
            <ProductCard
              product={product}
              canWrite={canWrite}
              sales={sales.byProduct[product.id]}
              isBestseller={sales.bestsellerId === product.id}
              storefrontCount={placements[product.id]?.length ?? 0}
              onDelete={() => setPendingDelete(product)}
              onCopyLink={() => handleLinkAction(product, "copy")}
              onOpenPage={() => handleLinkAction(product, "open")}
            />
          </li>
        ))}
      </ul>

      <Modal
        open={pendingDelete !== null}
        onClose={() => {
          if (!deleting) setPendingDelete(null);
        }}
        title="Delete this product?"
        description={
          pendingDelete
            ? `"${pendingDelete.title}" and its uploaded image and file will be permanently removed. Existing orders keep their record of the sale.${deleteStorefrontNote}`
            : undefined
        }
      >
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => setPendingDelete(null)}
            disabled={deleting}
            className={secondaryButtonClass}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirmDelete}
            disabled={deleting}
            className={destructiveButtonClass}
          >
            {deleting ? "Deleting…" : "Delete product"}
          </button>
        </div>
      </Modal>

      {/* Storefront chooser: shown when a link action targets a product that is
          on more than one storefront. The seller picks which URL to copy or
          open. One storefront: the action runs directly without this modal. */}
      <Modal
        open={linkTarget !== null}
        onClose={() => setLinkTarget(null)}
        title={linkTarget?.action === "open" ? "Open on which storefront?" : "Copy link for which storefront?"}
        description={
          linkTarget
            ? `"${linkTarget.product.title}" is on ${linkTargetStorefronts.length} storefronts. Pick one.`
            : undefined
        }
      >
        <div className="flex flex-col gap-2">
          {linkTargetStorefronts.map((sf) => (
            <button
              key={sf.id}
              type="button"
              onClick={() => {
                if (!linkTarget) return;
                setLinkTarget(null);
                executeLinkAction(linkTarget.action, sf.id, linkTarget.product.id);
              }}
              className={secondaryButtonClass}
            >
              {sf.name}
            </button>
          ))}
          <p className={infoTextClass}>
            Or cancel and use the storefront designer to choose a default.
          </p>
          <button
            type="button"
            onClick={() => setLinkTarget(null)}
            className={secondaryButtonClass}
          >
            Cancel
          </button>
        </div>
      </Modal>
    </>
  );
}
