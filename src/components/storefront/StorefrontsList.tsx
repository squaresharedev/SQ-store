"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, Plus, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { errorTextClass, focusRingClass, helpTextClass, iconPopClass, primaryButtonClass } from "@/components/ui/control-styles";
import { setSampleStorefrontHidden } from "@/lib/onboarding/actions";
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
import { SampleEmbedModal, SampleStorefrontCard } from "./SampleStorefrontCard";
import { RemovalNotice } from "@/components/products/RemovalNotice";

/**
 * Client wrapper owning the visible storefront set. Create opens the setup
 * flow, which inserts the row itself and hands back an id to navigate to;
 * delete confirms, then removes the card optimistically and restores it if the
 * server rejects. `products` feeds the cards' live grid previews.
 *
 * THE SAMPLE STOREFRONT (lib/storefront/sample.ts) is a card after the
 * seller's own, never counted among them. Hiding it is a flag on the person's
 * profile, flipped optimistically, with a quiet way back at the foot of the
 * list. With no storefront of their own, a create card sits beside the sample
 * instead of the full empty state, so the first thing a new seller sees is what
 * a storefront looks like and where theirs will go.
 */
export function StorefrontsList({
  storefronts: initial,
  total,
  products,
  canWrite,
  missingTraderDetails = [],
  sample = null,
}: {
  /**
   * Whether the sample storefront shows ("shown"), was hidden by this person
   * ("hidden"), or is not offered at all (null: a read-only role, or the flag
   * could not be read).
   */
  sample?: "shown" | "hidden" | null;
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
  const [sampleShown, setSampleShown] = useState(sample === "shown");
  const [sampleBusy, setSampleBusy] = useState(false);
  const [sampleEmbedOpen, setSampleEmbedOpen] = useState(false);
  const sampleOffered = sample !== null && canWrite;
  const sampleVisible = sampleOffered && sampleShown;
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
  const [prevSample, setPrevSample] = useState(sample);
  if (sample !== prevSample) {
    setPrevSample(sample);
    setSampleShown(sample === "shown");
  }

  async function changeSample(show: boolean) {
    if (sampleBusy) return;
    setSampleBusy(true);
    setSampleShown(show);
    const result = await setSampleStorefrontHidden(!show).catch(() => ({ ok: false }));
    setSampleBusy(false);
    if (!result.ok) {
      setSampleShown(!show);
      toast.error(
        show ? "Couldn't bring back the sample storefront." : "Couldn't hide the sample storefront.",
        { lines: ["Try again in a moment."] },
      );
    }
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
            : storefronts.length === 0 && sampleVisible
              ? // The sample is on screen and is not theirs: "0 storefronts"
                // beside a storefront card would read as a miscount.
                "No storefronts yet"
              : `${storefronts.length} storefront${storefronts.length === 1 ? "" : "s"}`}
        </p>
        {canWrite && (
          <Button
            data-tour="storefront-create"
            onClick={() => setWizardOpen(true)}
            disabled={creating}
          >
            <Plus
              className={`size-4 ${iconPopClass}`}
              strokeWidth={2}
              aria-hidden="true"
            />
            {creating ? "Creating…" : "New storefront"}
          </Button>
        )}
      </div>

      {/* A paused or removed storefront's statement of reasons, in full, above
          the grid. Not inside its card: a card has room for a state, and the
          pause needs a sentence and a button. Above the grid rather than on
          the editor, because the editor is a full-screen canvas and this is
          the page a seller lands on from the notification. */}
      {storefronts.map((storefront) =>
        storefront.removal ? (
          <RemovalNotice
            key={`takedown-${storefront.id}`}
            removal={storefront.removal}
            kind="storefront"
            id={storefront.id}
            title={storefront.name}
            canRequestReview={canWrite}
            className="mb-4"
          />
        ) : null,
      )}

      {storefronts.length === 0 && !sampleVisible ? (
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
              ? "Create your first storefront, then add products to its grid. Each product on it gets a page you can share."
              : "This store has no storefronts yet."}
          </p>
          {canWrite && (
            <button
              type="button"
              data-tour="storefront-create"
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
          {sampleVisible && (
            // After the seller's own cards, so "the first card" is always
            // theirs (and the guided tour's embed stop, which takes the first
            // embed button, points at their storefront when they have one).
            <li data-storefront-sample="">
              <SampleStorefrontCard
                onEmbed={() => setSampleEmbedOpen(true)}
                onHide={() => changeSample(false)}
                hiding={sampleBusy}
              />
            </li>
          )}
          {sampleVisible && storefronts.length === 0 && (
            <li>
              <button
                type="button"
                onClick={() => setWizardOpen(true)}
                disabled={creating}
                className={cn(
                  "flex size-full min-h-56 flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border bg-background p-6 text-center transition-colors duration-base ease-standard hover:bg-muted disabled:pointer-events-none motion-reduce:transition-none",
                  focusRingClass,
                )}
              >
                <span className="flex size-12 items-center justify-center rounded-full bg-muted">
                  <Plus className="size-6 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
                </span>
                <span className="text-base font-semibold text-foreground">
                  {creating ? "Creating…" : "Create your first storefront"}
                </span>
                <span className="max-w-xs font-inter text-sm text-muted-foreground">
                  Add your products to its grid. Each one gets a page you can share.
                </span>
              </button>
            </li>
          )}
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

      {sampleOffered && !sampleShown && (
        <div className="mt-8 flex justify-center">
          <Button
            variant="ghost"
            className="px-2 py-1.5 text-xs"
            onClick={() => changeSample(true)}
            disabled={sampleBusy}
          >
            <Eye className="size-3.5" strokeWidth={2} aria-hidden="true" />
            Show the sample storefront
          </Button>
        </div>
      )}

      <SampleEmbedModal
        open={sampleEmbedOpen}
        onClose={() => setSampleEmbedOpen(false)}
        canCreate={canWrite}
        onCreate={() => {
          setSampleEmbedOpen(false);
          setWizardOpen(true);
        }}
      />

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
