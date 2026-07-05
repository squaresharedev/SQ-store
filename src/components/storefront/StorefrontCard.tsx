import Link from "next/link";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatOrderDate } from "@/lib/format/date";
import type { StorefrontSummary } from "@/lib/storefront/queries";
import { resolveBackgroundStyle } from "./background-presets";

// Presentational card. The whole card is a link to the editor (a stretched
// overlay), with the delete button layered above it so it stays clickable
// without nesting a <button> inside an <a>.
export function StorefrontCard({
  storefront,
  onDelete,
}: {
  storefront: StorefrontSummary;
  onDelete: () => void;
}) {
  const { id, name, blockCount, updatedAt, theme } = storefront;

  return (
    <div className="relative flex flex-col rounded-md border border-border bg-card p-4 shadow-sm transition-shadow duration-180 ease-in-out hover:shadow-md motion-reduce:transition-none">
      <Link
        href={`/storefront/${id}`}
        aria-label={`Edit ${name}`}
        className="absolute inset-0 z-10 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      />

      <div className="pointer-events-none relative z-0">
        <div
          aria-hidden="true"
          style={resolveBackgroundStyle(theme.background)}
          className="aspect-[4/3] w-full rounded-sm border border-border"
        />
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

      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete ${name}`}
        className={cn(
          "absolute right-3 top-3 z-20 inline-flex size-9 items-center justify-center rounded-none border border-border bg-background text-muted-foreground",
          "transition-colors duration-180 ease-in-out motion-reduce:transition-none hover:bg-accent hover:text-destructive",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        )}
      >
        <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}
