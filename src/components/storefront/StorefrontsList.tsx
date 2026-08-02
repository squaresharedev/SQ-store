"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Store } from "lucide-react";
import { iconPopClass, primaryButtonClass } from "@/components/ui/control-styles";
import { ActionErrorNotice } from "@/components/ui/ActionErrorNotice";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import type { ActionError } from "@/lib/errors";
import {
  createStorefront,
  deleteStorefront,
  fetchStorefrontsPage,
} from "@/lib/storefront/actions";
import type { StorefrontSummary } from "@/lib/storefront/queries";
import type { Product } from "@/types/product";
import { StorefrontCard } from "./StorefrontCard";
import { EmbedModal } from "./EmbedModal";

/**
 * Client wrapper owning the visible storefront set. Create inserts a row and
 * navigates straight into its editor; delete confirms, then removes the card
 * optimistically and restores it if the server rejects. `products` feeds the
 * cards' live grid previews.
 */
export function StorefrontsList({
  storefronts: initial,
  total,
  products,
  canWrite,
}: {
  storefronts: StorefrontSummary[];
  /** Exact count of ALL storefronts; more exist than `storefronts` when the
   *  first page is truncated, and the list must say so. */
  total: number;
  products: Product[];
  /** Hide create/delete/embed controls when the active role is read-only. */
  canWrite: boolean;
}) {
  const router = useRouter();
  const [storefronts, setStorefronts] = useState(initial);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);
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

  async function handleCreate() {
    setError(null);
    setCreating(true);
    const result = await createStorefront();
    if (!result.ok) {
      setError(result.error);
      setCreating(false);
      return;
    }
    // Leave `creating` true — we're navigating away to the new editor.
    router.push(`/storefront/${result.id}`);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setDeleting(true);
    setError(null);
    const result = await deleteStorefront(target.id);
    setDeleting(false);
    setPendingDelete(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setStorefronts((current) => current.filter((s) => s.id !== target.id));
    setRemoved((n) => n + 1);
  }

  return (
    <>
      {error && <ActionErrorNotice error={error} className="mb-4" />}

      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="font-inter text-sm text-muted-foreground">
          {hasMore
            ? `Showing ${storefronts.length} of ${knownTotal} storefronts`
            : `${storefronts.length} storefront${storefronts.length === 1 ? "" : "s"}`}
        </p>
        {canWrite && (
          <Button onClick={handleCreate} disabled={creating}>
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
        <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-border bg-background px-6 py-16 text-center">
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
              onClick={handleCreate}
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
            <p role="alert" className="font-inter text-sm text-destructive">
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

      <EmbedModal
        storefront={embedTarget}
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
        // server-side and its outcome still lands (row removed on success, the
        // page-level ActionErrorNotice on failure). Blocking ESC/backdrop/X
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
