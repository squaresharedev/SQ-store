"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  errorTextClass,
  ghostButtonClass,
  helpTextClass,
  iconNudgeRightClass,
  iconPopClass,
} from "@/components/ui/control-styles";
import { SAMPLE_STOREFRONT_PATH } from "@/lib/storefront/sample";
import { useToast } from "@/components/ui/Toast";
import { useActionErrorToast } from "@/components/ui/ActionErrorNotice";
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
import { StorefrontEmptyState } from "./StorefrontEmptyState";
import { RemovalNotice } from "@/components/products/RemovalNotice";

/**
 * Client wrapper owning the visible storefront set. Create opens the setup
 * flow, which inserts the row itself and hands back an id to navigate to;
 * delete confirms, then removes the card optimistically and restores it if the
 * server rejects. `products` feeds the cards' live grid previews.
 *
 * THE SAMPLE STOREFRONT (lib/storefront/sample.ts) is a quiet link at the foot
 * of the list, never a card: the list holds the seller's own storefronts and
 * nothing else, and with none it is the empty state alone. The link opens the
 * sample in the designer, where nothing saves, and is what the guided tour's
 * "See how it's done" stop points at (`data-storefront-sample`).
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
   * Whether the link to the sample storefront shows ("shown"), stays away
   * because this person hid the sample back when it was a card ("hidden"), or
   * is not offered at all (null: a read-only role, or the flag could not be
   * read).
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
  const t = useTranslations("Storefront.list");
  const tSample = useTranslations("Storefront.sample.card");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const toast = useToast();
  const showActionError = useActionErrorToast();
  const [storefronts, setStorefronts] = useState(initial);
  const [wizardOpen, setWizardOpen] = useState(false);
  const sampleLink = canWrite && sample === "shown";
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
      showActionError(result.error);
      return;
    }
    setStorefronts((current) => current.filter((s) => s.id !== target.id));
    setRemoved((n) => n + 1);
    toast.success(t("deleteToast", { name: target.name }));
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        {/* No count over an empty list: the empty state below already says
            so, and "0 storefronts" above it would say it twice. */}
        <p className={helpTextClass}>
          {hasMore
            ? t("showingOf", { count: storefronts.length, total: knownTotal })
            : storefronts.length > 0
              ? t("count", { count: storefronts.length })
              : null}
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
            {creating ? t("creating") : t("new")}
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

      {storefronts.length === 0 ? (
        <StorefrontEmptyState
          canWrite={canWrite}
          data-tour="storefront-create"
          onCreate={() => setWizardOpen(true)}
          creating={creating}
        />
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
              {t("loadMoreError")}
            </p>
          )}
          <Button
            type="button"
            variant="ghost"
            onClick={handleLoadMore}
            disabled={loadingMore}
          >
            {loadingMore
              ? tCommon("actions.loading")
              : loadMoreFailed
                ? tCommon("actions.tryAgain")
                : t("loadMore", { remaining: knownTotal - storefronts.length })}
          </Button>
        </div>
      )}

      {sampleLink && (
        // The attribute is on a wrapper that hugs the link, so the tour's
        // spotlight frames the link rather than a full-width row.
        <div className="mt-6 flex justify-center">
          <span data-storefront-sample="" className="inline-flex">
            <Link
              href={SAMPLE_STOREFRONT_PATH}
              className={cn(ghostButtonClass, "px-3 py-2")}
            >
              {tSample("open")}
              <ArrowRight
                className={cn("size-4", iconNudgeRightClass)}
                strokeWidth={2}
                aria-hidden="true"
              />
            </Link>
          </span>
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
        title={t("deleteTitle")}
        description={
          pendingDelete
            ? t("deleteDesc", { name: pendingDelete.name })
            : undefined
        }
      >
        <div className="flex justify-end gap-3">
          <Button
            variant="secondary"
            onClick={() => setPendingDelete(null)}
            disabled={deleting}
          >
            {tCommon("actions.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={confirmDelete}
            disabled={deleting}
          >
            {deleting ? tCommon("actions.deleting") : tCommon("actions.delete")}
          </Button>
        </div>
      </Modal>
    </>
  );
}
