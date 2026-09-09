"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { errorTextClass, helpTextClass, iconPopClass, primaryButtonClass } from "@/components/ui/control-styles";
import { emptyStateClass } from "@/components/ui/surface-styles";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  deleteStorefront,
  fetchStorefrontsPage,
} from "@/lib/storefront/actions";
import type { StorefrontSummary } from "@/lib/storefront/queries";
import type { TraderIdentityField } from "@/lib/settings/trader-identity";
import type { Product } from "@/types/product";
import { StorefrontCard } from "./StorefrontCard";
import { CreateStorefrontWizard } from "./CreateStorefrontWizard";
import { EmbedModal } from "./EmbedModal";

/**
 * Client wrapper owning the visible storefront set. Create opens the setup
 * flow, which inserts the row itself and hands back an id to navigate to;
 * delete confirms, then removes the card optimistically and restores it if the
 * server rejects. `products` feeds the cards' live grid previews.
 */
export function StorefrontsList({
  storefronts: initial,
  total,
  products,
  canWrite,
  missingTraderDetails = [],
}: {
  storefronts: StorefrontSummary[];
  /** Exact count of ALL storefronts; more exist than `storefronts` when the
   *  first page is truncated, and the list must say so. */
  total: number;
  products: Product[];
  /** Hide create/delete/embed controls when the active role is read-only. */
  canWrite: boolean;
  /** Trader details this store still owes buyers; passed to the embed modal,
   *  which is where publishing a storefront actually happens. */
  missingTraderDetails?: readonly TraderIdentityField[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [storefronts, setStorefronts] = useState(initial);
  const [wizardOpen, setWizardOpen] = useState(false);
  // Stays true from the moment the wizard hands back an id until the route
  // change lands, so the create buttons can't fire a second time behind it.
  const [creating, setCreating] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  // Deletes shrink the true count locally between server revalidations.
  const [removed, setRemoved] = useState(0);
  const knownTotal = Math.max(storefronts.length, total - removed);
  const hasMore = storefronts.length < knownTotal;

  async function handleLoadMore() {
    if (loadingMore) return;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const page = await fetchStorefrontsPage(storefronts.length);
      setStorefronts((current) => {
        const seen = new Set(current.map((s) => s.id));
        return [...current, ...page.rows.filter((s) => !seen.has(s.id))];
      });
    } catch {
      setLoadMoreFailed(true); // same click retries; offset is re-derived
    } finally {
      setLoadingMore(false);
    }
  }
  const [pendingDelete, setPendingDelete] = useState<StorefrontSummary | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const [embedTarget, setEmbedTarget] = useState<StorefrontSummary | null>(
    null,
  );

  const productsById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );

  // Adopt fresh props after a server revalidation (same render-time reset the
  // ProductList / Sidebar use). The local delete offset resets with them: the
  // fresh `total` already reflects the deletions.
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setStorefronts(initial);
    setRemoved(0);
  }

  function handleCreated(id: string) {
    // Leave `creating` true: we're navigating away to the new editor.
    setCreating(true);
    setWizardOpen(false);
    router.push(`/storefront/${id}`);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setDeleting(true);
    const result = await deleteStorefront(target.id);
    setDeleting(false);
    setPendingDelete(null);
    if (!result.ok) {
      toast.error(result.error.message, { lines: [result.error.fix] });
      return;
    }
    setStorefronts((current) => current.filter((s) => s.id !== target.id));
    setRemoved((n) => n + 1);
    toast.success(`"${target.name}" was deleted.`);
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className={helpTextClass}>
          {hasMore
            ? `Showing ${storefronts.length} of ${knownTotal} storefronts`
            : `${storefronts.length} storefront${storefronts.length === 1 ? "" : "s"}`}
        </p>
        {canWrite && (
          <Button onClick={() => setWizardOpen(true)} disabled={creating}>
            <Plus
              className={`size-4 ${iconPopClass}`}
              strokeWidth={2}
              aria-hidden="true"
            />
            {creating ? "Creating…" : "New storefront"}
          </Button>
        )}
      </div>

      {storefronts.length === 0 ? (
        <div className={cn(emptyStateClass, "bg-background")}>
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <Store
              className="size-6 text-muted-foreground"
              strokeWidth={1.5}
              aria-hidden="true"
            />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-foreground">
            No storefronts yet
          </h2>
          <p className="mt-1 max-w-sm font-inter text-sm text-muted-foreground">
            {canWrite
              ? "Create your first storefront to arrange products into a grid buyers can browse and buy from."
              : "This store has no storefronts yet."}
          </p>
          {canWrite && (
            <button
              type="button"
              onClick={() => setWizardOpen(true)}
              disabled={creating}
              className={`${primaryButtonClass} mt-5`}
            >
              <Plus
                className={`size-4 ${iconPopClass}`}
                strokeWidth={2}
                aria-hidden="true"
              />
              {creating ? "Creating…" : "Create storefront"}
            </button>
          )}
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {storefronts.map((storefront) => (
            <li key={storefront.id}>
              <StorefrontCard
                storefront={storefront}
                productsById={productsById}
                canWrite={canWrite}
                onEmbed={() => setEmbedTarget(storefront)}
                onDelete={() => setPendingDelete(storefront)}
              />
            </li>
          ))}
        </ul>
      )}

      {hasMore && (
        <div className="mt-6 flex flex-col items-center gap-2">
          {loadMoreFailed && (
            <p role="alert" className={errorTextClass}>
              Couldn&apos;t load more storefronts. Try again.
            </p>
          )}
          <Button
            type="button"
            variant="ghost"
            onClick={handleLoadMore}
            disabled={loadingMore}
          >
            {loadingMore
              ? "Loading…"
              : loadMoreFailed
                ? "Try again"
                : `Load more (${knownTotal - storefronts.length} remaining)`}
          </Button>
        </div>
      )}

      <CreateStorefrontWizard
        open={wizardOpen}
        // Dismissing is a cancel: the wizard only inserts a row when the seller
        // finishes or skips, so nothing is left behind here.
        onClose={() => setWizardOpen(false)}
        onCreated={handleCreated}
        productCount={products.length}
        // Newest-edited first, so [0] is the storefront they last worked on and
        // the likeliest source of answers that still hold.
        previousBrief={storefronts[0]?.brief}
      />

      <EmbedModal
        storefront={embedTarget}
        missingTraderDetails={missingTraderDetails}
        onClose={() => setEmbedTarget(null)}
        onSaved={(id, embed) =>
          setStorefronts((current) =>
            current.map((s) =>
              s.id === id ? { ...s, config: { ...s.config, embed } } : s,
            ),
          )
        }
      />

      <Modal
        open={pendingDelete !== null}
        // Closable even while the delete is in flight: the action carries on
        // server-side and its outcome still lands as a toast either way, which
        // is exactly why closing early is now safe. Blocking ESC/backdrop/X
        // here turned a hung request into a user trapped in a modal.
        onClose={() => setPendingDelete(null)}
        title="Delete storefront?"
        description={
          pendingDelete
            ? `"${pendingDelete.name}" and its grid will be permanently removed. This cannot be undone.`
            : undefined
        }
      >
        <div className="flex justify-end gap-3">
          <Button
            variant="secondary"
            onClick={() => setPendingDelete(null)}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={confirmDelete}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
