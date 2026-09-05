"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Image as ImageIcon, Plus, Search } from "lucide-react";
import type { Product } from "@/types/product";
import { formatPrice } from "@/lib/format";
import { searchCatalogProducts } from "@/lib/products/picker-actions";
import { PICKER_SEARCH_MAX_LENGTH } from "@/lib/products/picker-constants";
import { cn } from "@/lib/utils";
import { TYPING_DEBOUNCE_MS } from "@/lib/typing-debounce";
import {
  fieldBaseClass,
  helpTextClass,
  iconButtonClass,
} from "@/components/ui/control-styles";

const ADD_BUTTON_CLASS = cn(
  iconButtonClass,
  "size-8 shrink-0 disabled:pointer-events-none disabled:opacity-40",
);

/**
 * Pick from the seller's existing products; each can be in the grid once.
 *
 * The `products` prop is the designer's seed catalogue, which is BOUNDED (the
 * newest 500; every row costs an R2 presign). Typing in the search box goes
 * back to the server, so a product outside that bound is still findable and
 * placeable. Products found that way are handed to `onFound` so the designer
 * can merge them into its catalogue state BEFORE a block referencing them
 * renders; without that merge the block would be dropped as unknown.
 *
 * SF-01: Draft products are badged so the seller knows buyers cannot reach them.
 * SF-07: Multi-select lets the seller add several products at once.
 */
export function ProductPicker({
  products,
  usedProductIds,
  onAdd,
  onFound,
}: {
  products: Product[];
  usedProductIds: ReadonlySet<string>;
  onAdd: (productId: string) => void;
  /** Merge server-found products into the designer's catalogue. */
  onFound?: (found: Product[]) => void;
}) {
  const [search, setSearch] = React.useState("");
  const [remoteState, setRemoteState] = React.useState<{
    results: Product[] | null;
    searching: boolean;
    failed: boolean;
  }>({ results: null, searching: false, failed: false });
  // Monotonic token so a slow stale response can never overwrite a newer one.
  const requestSeq = React.useRef(0);

  // SF-07: Track which available products are selected for batch-add.
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());

  const term = search.trim().toLowerCase();

  React.useEffect(() => {
    // Every state write lives inside the debounce callback (async), so this
    // effect never sets state synchronously; the empty-term case is handled
    // by DERIVING display values from `term` below, not by resetting state.
    if (!term) return;
    const seq = ++requestSeq.current;
    const timer = setTimeout(async () => {
      setRemoteState((s) => ({ ...s, searching: true }));
      try {
        const found = await searchCatalogProducts(term);
        if (seq !== requestSeq.current) return;
        setRemoteState({ results: found, searching: false, failed: false });
        onFound?.(found);
      } catch {
        if (seq !== requestSeq.current) return;
        // Local matches still show; only the server reach failed.
        setRemoteState({ results: null, searching: false, failed: true });
      }
    }, TYPING_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      // Invalidate any in-flight response for the outgoing term.
      requestSeq.current += 1;
    };
    // `onFound` is a stable designer callback; term drives the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  // With no term the remote machinery is inert regardless of stale state.
  const remote = term ? remoteState.results : null;
  const searching = term ? remoteState.searching : false;
  const searchFailed = term ? remoteState.failed : false;

  if (products.length === 0 && !term) {
    return (
      <p className={helpTextClass}>
        You have no products yet.{" "}
        <Link
          href="/products"
          className="font-medium text-foreground underline decoration-border underline-offset-4 transition-colors duration-base ease-standard hover:decoration-foreground motion-reduce:transition-none"
        >
          Add a product
        </Link>{" "}
        first, then arrange it here.
      </p>
    );
  }

  // Local narrowing is instant; server results (which may include products
  // outside the seeded 500) merge in deduplicated once they arrive.
  const localMatches = term
    ? products.filter((p) => p.title.toLowerCase().includes(term))
    : products;
  const seen = new Set(localMatches.map((p) => p.id));
  const merged = [
    ...localMatches,
    ...(remote ?? []).filter((p) => !seen.has(p.id)),
  ];

  const selected = merged.filter((product) => usedProductIds.has(product.id));
  const available = merged.filter((product) => !usedProductIds.has(product.id));

  // SF-07: "Add all" is shown only when the grid is completely empty.
  const gridIsEmpty = usedProductIds.size === 0;

  function toggleSelect(productId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  }

  function addSelected() {
    for (const id of selectedIds) {
      onAdd(id);
    }
    setSelectedIds(new Set());
  }

  function addAll() {
    for (const p of available) {
      onAdd(p.id);
    }
    setSelectedIds(new Set());
  }

  // Clean up selectedIds that have since been added or no longer appear.
  const availableIds = new Set(available.map((p) => p.id));
  const pendingSelected = [...selectedIds].filter((id) => availableIds.has(id));
  const pendingCount = pendingSelected.length;

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          strokeWidth={2}
        />
        <input
          type="search"
          // Titles cap at 200 characters, so a longer term cannot match a
          // product that exists. The action clamps to the same constant -- this
          // is the affordance, not the gate.
          maxLength={PICKER_SEARCH_MAX_LENGTH}
          value={search}
          onChange={(event) =>
            setSearch(event.target.value.slice(0, PICKER_SEARCH_MAX_LENGTH))
          }
          placeholder="Search products"
          aria-label="Search your products"
          className={cn(fieldBaseClass, "py-2 pl-8 text-sm")}
        />
      </div>

      {term && searching && merged.length === 0 && (
        <p className={helpTextClass} role="status">
          Searching...
        </p>
      )}
      {term && !searching && merged.length === 0 && !searchFailed && (
        <p className={helpTextClass} role="status">
          No products match &ldquo;{search.trim()}&rdquo;.
        </p>
      )}
      {searchFailed && (
        <p className="font-inter text-xs text-destructive" role="alert">
          Search is unavailable right now; showing what&apos;s already loaded.
        </p>
      )}

      {selected.length > 0 && (
        <div className="space-y-1">
          <p className="font-inter text-xs font-medium text-muted-foreground">
            In grid
          </p>
          <ProductList
            products={selected}
            usedProductIds={usedProductIds}
            selectedIds={selectedIds}
            onAdd={onAdd}
            onToggleSelect={toggleSelect}
            selectable={false}
          />
        </div>
      )}
      {available.length > 0 && (
        <div className="space-y-1">
          {selected.length > 0 && (
            <p className="font-inter text-xs font-medium text-muted-foreground">
              Available
            </p>
          )}
          <ProductList
            products={available}
            usedProductIds={usedProductIds}
            selectedIds={selectedIds}
            onAdd={onAdd}
            onToggleSelect={toggleSelect}
            selectable={true}
          />
          {/* SF-07: batch-add controls */}
          <div className="flex items-center gap-2 pt-1">
            {pendingCount > 0 && (
              <button
                type="button"
                onClick={addSelected}
                className="flex-1 rounded-md bg-foreground px-3 py-1.5 font-inter text-xs font-medium text-background transition-opacity duration-base ease-standard hover:opacity-80 motion-reduce:transition-none"
              >
                Add {pendingCount} selected
              </button>
            )}
            {gridIsEmpty && pendingCount === 0 && available.length > 1 && (
              <button
                type="button"
                onClick={addAll}
                className="flex-1 rounded-md border border-border px-3 py-1.5 font-inter text-xs font-medium text-foreground transition-colors duration-base ease-standard hover:bg-muted motion-reduce:transition-none"
              >
                Add all ({available.length})
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProductList({
  products,
  usedProductIds,
  selectedIds,
  onAdd,
  onToggleSelect,
  selectable,
}: {
  products: Product[];
  usedProductIds: ReadonlySet<string>;
  selectedIds: Set<string>;
  onAdd: (productId: string) => void;
  onToggleSelect: (productId: string) => void;
  /** Whether checkboxes are shown (only for the "available" group). */
  selectable: boolean;
}) {
  return (
    <ul className="space-y-1">
      {products.map((product) => {
        const used = usedProductIds.has(product.id);
        const isChecked = selectable && selectedIds.has(product.id);
        const isDraft = product.status === "draft";

        return (
          <li key={product.id} className="flex items-center gap-2">
            {selectable && (
              <button
                type="button"
                onClick={() => onToggleSelect(product.id)}
                aria-pressed={isChecked}
                aria-label={`${isChecked ? "Deselect" : "Select"} ${product.title}`}
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded border transition-colors duration-base ease-standard motion-reduce:transition-none",
                  isChecked
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-transparent hover:border-foreground",
                )}
              >
                {isChecked && (
                  <Check className="size-3" strokeWidth={2.5} aria-hidden />
                )}
              </button>
            )}
            <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-muted">
              {product.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed R2 URL; plain img for a thumbnail.
                <img
                  src={product.imageUrl}
                  alt=""
                  draggable={false}
                  className="size-full object-cover"
                />
              ) : (
                <ImageIcon
                  className="size-4 text-muted-foreground"
                  strokeWidth={2}
                  aria-hidden="true"
                />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="block truncate text-sm font-medium text-foreground">
                  {product.title}
                </span>
                {/* SF-01: badge draft products so sellers know buyers hit a dead link */}
                {isDraft && (
                  <span
                    aria-label="Draft product -- not visible to buyers"
                    className="shrink-0 rounded-sm bg-amber-100 px-1 py-0.5 font-inter text-[10px] font-medium leading-none text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                  >
                    Draft
                  </span>
                )}
              </span>
              <span className="block font-inter text-xs text-muted-foreground">
                {formatPrice(product.price, product.currency)}
              </span>
            </span>
            {!selectable || !selectedIds.size ? (
              <button
                type="button"
                onClick={() => onAdd(product.id)}
                disabled={used}
                aria-label={
                  used
                    ? `${product.title} is in the grid`
                    : `Add ${product.title} to grid`
                }
                className={cn(ADD_BUTTON_CLASS)}
              >
                <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
