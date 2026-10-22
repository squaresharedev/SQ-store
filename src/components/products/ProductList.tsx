"use client";

import { useState } from "react";
import { SearchX, Store, Trash2, Truck } from "lucide-react";
import { useTranslations } from "next-intl";
import { emptyStateClass, productGridClass } from "@/components/ui/surface-styles";
import type { Product, ProductSalesSummary } from "@/types/product";
import { deleteProduct } from "@/lib/products/actions";
import { useToast } from "@/components/ui/Toast";
import { useActionErrorToast } from "@/components/ui/ActionErrorNotice";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { HeroMark } from "@/components/ui/HeroMark";
import { Modal, ModalActions } from "@/components/ui/modal";
import { ProductThumb } from "@/components/ui/ProductThumb";
import {
  dangerNoticeClass,
  ghostButtonClass,
  infoTextClass,
  secondaryButtonClass,
} from "@/components/ui/control-styles";
import type { StorefrontPlacement } from "@/lib/products/queries";
import type { TraderIdentityField } from "@/lib/settings/trader-identity";
import {
  productPagePath,
  productPageUrl,
} from "@/lib/storefront/product-page-url";
import { BuyButtonDialog } from "./BuyButtonDialog";
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
  toShip = {},
  missingTraderDetails = [],
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
  /** Orders still to ship, by product id: on each card, and the delete
   *  dialog's warning (the delete action checks again for itself). */
  toShip?: Record<string, number>;
  /** Trader details the store still owes buyers: the buy button dialog says
   *  so instead of handing out a link the page would refuse. */
  missingTraderDetails?: readonly TraderIdentityField[];
  /** True when a search or status filter is narrowing the list. Distinguishes
   *  "no products yet" from "nothing matched", which need different words. */
  filtered?: boolean;
  onClearFilters?: () => void;
}) {
  const t = useTranslations("Products.list");
  const tCommon = useTranslations("Common.actions");
  const toast = useToast();
  const showActionError = useActionErrorToast();
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
  // The product whose "Add to your website" dialog is open. The dialog picks
  // the storefront itself, so it needs no chooser step first.
  const [buyButtonFor, setBuyButtonFor] = useState<Product | null>(null);

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
    // The count the dialog warned about: the action refuses if more orders
    // than that are now waiting, so a newer one is never deleted past unseen.
    const result = await deleteProduct(target.id, toShip[target.id] ?? 0);
    setDeleting(false);
    setPendingDelete(null);
    if (!result.ok) {
      setProducts(previous);
      // When the refusal was a newer order, the action has refreshed the
      // page, so the next attempt's dialog shows the right warning.
      showActionError(result.error);
      return;
    }
    // The card leaving the grid is the only other evidence a delete worked,
    // and on a full page of similar cards that is easy to miss — especially
    // when the confirm modal was covering the one that went.
    toast.success(t("deleted", { title: target.title }));
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
      () => toast.success(t("linkCopied")),
      () =>
        toast.error(t("copyFailed"), {
          lines: [t("copyFailedUrl", { url: productPagePath(storefrontId, productId) })],
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
      toast.info(t("notOnStorefront"));
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
            {t("noMatch.title")}
          </p>
          <p className="mt-1 max-w-xs font-inter text-sm text-muted-foreground">
            {t("noMatch.body")}
          </p>
          {onClearFilters && (
            <button
              type="button"
              onClick={onClearFilters}
              className={`${secondaryButtonClass} mt-4`}
            >
              {t("noMatch.clear")}
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
  // Buyers still waiting on this product. Their orders stay (with its name
  // and price), but deleting it then is a decision, so it is said first.
  const deleteToShip = pendingDelete ? (toShip[pendingDelete.id] ?? 0) : 0;

  // Build the storefront chooser description.
  const linkTargetStorefronts = linkTarget
    ? (placements[linkTarget.product.id] ?? [])
    : [];

  return (
    <>
      {/* As many 14rem+ columns as fit, not viewport breakpoints: beside the
          sidebar those gave a laptop cards under 10rem wide. */}
      <ul className={productGridClass}>
        {products.map((product) => (
          <li key={product.id}>
            <ProductCard
              product={product}
              canWrite={canWrite}
              sales={sales.byProduct[product.id]}
              isBestseller={sales.bestsellerId === product.id}
              storefrontCount={placements[product.id]?.length ?? 0}
              toShip={toShip[product.id] ?? 0}
              onDelete={() => setPendingDelete(product)}
              onCopyLink={() => handleLinkAction(product, "copy")}
              onOpenPage={() => handleLinkAction(product, "open")}
              onBuyButton={() => setBuyButtonFor(product)}
            />
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => {
          if (!deleting) setPendingDelete(null);
        }}
        tone="danger"
        // The product itself, with what is about to happen to it.
        visual={
          <HeroMark tone="danger" badge={Trash2} size="lg">
            <ProductThumb src={pendingDelete?.imageUrl} className="size-full" />
          </HeroMark>
        }
        title={t("deleteDialog.title")}
        description={
          pendingDelete
            ? t("deleteDialog.description", {
                title: pendingDelete.title,
                storefronts: deleteStorefronts.length,
              })
            : undefined
        }
        confirmLabel={deleteToShip > 0 ? t("deleteDialog.confirmAnyway") : t("deleteDialog.confirm")}
        pendingLabel={tCommon("deleting")}
        pending={deleting}
        onConfirm={handleConfirmDelete}
      >
        {deleteToShip > 0 && (
          <div role="status" className={dangerNoticeClass} data-delete-to-ship={deleteToShip}>
            <Truck className="mt-0.5 size-4 shrink-0 text-destructive" strokeWidth={2} aria-hidden="true" />
            <p className="font-inter text-sm text-foreground">
              {t("deleteDialog.toShip", { count: deleteToShip })}
            </p>
          </div>
        )}
      </ConfirmDialog>

      {/* Storefront chooser: shown when a link action targets a product that is
          on more than one storefront. The seller picks which URL to copy or
          open. One storefront: the action runs directly without this modal. */}
      <Modal
        open={linkTarget !== null}
        onClose={() => setLinkTarget(null)}
        // Which product the link is for, as a picture.
        visual={
          <HeroMark>
            <ProductThumb src={linkTarget?.product.imageUrl} className="size-full" />
          </HeroMark>
        }
        title={linkTarget?.action === "open" ? t("chooser.openTitle") : t("chooser.copyTitle")}
        description={
          linkTarget
            ? t("chooser.description", {
                title: linkTarget.product.title,
                count: linkTargetStorefronts.length,
              })
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
              className={`${secondaryButtonClass} justify-start`}
            >
              <Store className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
              {sf.name}
            </button>
          ))}
          <p className={`${infoTextClass} text-center`}>
            {t("chooser.hint")}
          </p>
          <ModalActions>
            <button
              type="button"
              onClick={() => setLinkTarget(null)}
              className={ghostButtonClass}
            >
              {tCommon("cancel")}
            </button>
          </ModalActions>
        </div>
      </Modal>

      {buyButtonFor && (
        <BuyButtonDialog
          key={buyButtonFor.id}
          product={buyButtonFor}
          placements={placements[buyButtonFor.id] ?? []}
          canWrite={canWrite}
          missingTraderDetails={missingTraderDetails}
          onClose={() => setBuyButtonFor(null)}
        />
      )}
    </>
  );
}
