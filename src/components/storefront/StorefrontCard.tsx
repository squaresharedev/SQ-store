"use client";

import Link from "next/link";
import { Code, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatOrderDate } from "@/lib/format/date";
import type { Product } from "@/types/product";
import type { StorefrontSummary } from "@/lib/storefront/queries";
import { StorefrontPreview } from "./StorefrontPreview";

const CARD_ACTION_CLASS = cn(
  "inline-flex size-9 items-center justify-center rounded-none border border-border bg-background text-muted-foreground",
  "transition-colors duration-180 ease-in-out motion-reduce:transition-none hover:bg-accent",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
);

// Presentational card. The whole card is a link to the editor (a stretched
// overlay), with the action buttons layered above it so they stay clickable
// without nesting a <button> inside an <a>.
export function StorefrontCard({
  storefront,
  productsById,
  onEmbed,
  onDelete,
}: {
  storefront: StorefrontSummary;
  productsById: ReadonlyMap<string, Product>;
  onEmbed: () => void;
  onDelete: () => void;
}) {
  const { id, name, blockCount, updatedAt, config } = storefront;

  return (
    <div className="relative flex flex-col rounded-md border border-border bg-card p-4 shadow-sm transition-shadow duration-180 ease-in-out hover:shadow-md motion-reduce:transition-none">
      <Link
        href={`/storefront/${id}`}
        aria-label={`Edit ${name}`}
        className="absolute inset-0 z-10 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      />

      <div className="pointer-events-none relative z-0">
        {/* Live miniature of the actual storefront, clipped to the card box. */}
        <div
          aria-hidden="true"
          className="aspect-[4/3] w-full overflow-hidden rounded-sm border border-border"
        >
          <StorefrontPreview config={config} productsById={productsById} />
        </div>
        <div className="mt-3 pr-9">
          <h3 className="truncate text-base font-semibold text-foreground">
            {name}
          </h3>
          <p className="mt-0.5 font-inter text-sm text-muted-foreground">
            {blockCount} block{blockCount === 1 ? "" : "s"} · updated{" "}
            {formatOrderDate(updatedAt)}
          </p>
        </div>
      </div>

      <div className="absolute right-3 top-3 z-20 flex gap-1.5">
        <button
          type="button"
          onClick={onEmbed}
          aria-label={`Embed ${name}`}
          className={cn(CARD_ACTION_CLASS, "hover:text-foreground")}
        >
          <Code className="size-4" strokeWidth={2} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${name}`}
          className={cn(CARD_ACTION_CLASS, "hover:text-destructive")}
        >
          <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
