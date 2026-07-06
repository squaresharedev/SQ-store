"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Plus, Store } from "lucide-react";
import { iconPopClass, primaryButtonClass } from "@/components/ui/control-styles";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  createStorefront,
  deleteStorefront,
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
  products,
}: {
  storefronts: StorefrontSummary[];
  products: Product[];
}) {
  const router = useRouter();
  const [storefronts, setStorefronts] = useState(initial);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  // ProductList / Sidebar use).
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setStorefronts(initial);
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
  }

  return (
    <>
      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3"
        >
          <AlertCircle
            className="mt-0.5 size-4 shrink-0 text-destructive"
            strokeWidth={2}
            aria-hidden="true"
          />
          <p className="font-inter text-sm text-destructive">{error}</p>
        </div>
      )}

      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="font-inter text-sm text-muted-foreground">
          {storefronts.length} storefront{storefronts.length === 1 ? "" : "s"}
        </p>
        <Button onClick={handleCreate} disabled={creating}>
          <Plus
            className={`size-4 ${iconPopClass}`}
            strokeWidth={2}
            aria-hidden="true"
          />
          {creating ? "Creating…" : "New storefront"}
        </Button>
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
            Create your first storefront to arrange products into a grid buyers
            can browse and buy from.
          </p>
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
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {storefronts.map((storefront) => (
            <li key={storefront.id}>
              <StorefrontCard
                storefront={storefront}
                productsById={productsById}
                onEmbed={() => setEmbedTarget(storefront)}
                onDelete={() => setPendingDelete(storefront)}
              />
            </li>
          ))}
        </ul>
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
        onClose={() => (deleting ? undefined : setPendingDelete(null))}
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
