import { Skeleton } from "@/components/ui/skeleton";
/**
 * Route-level loading state for the storefront EDITOR. Full-screen by design:
 * this segment renders without the dashboard sidebar (see storefront/layout),
 * so the skeleton mirrors the editor's own chrome (toolbar strip + canvas +
 * inspector rail) rather than the list's card grid. Without this file a direct
 * navigation to /storefront/[id] showed a blank screen until the server
 * resolved the storefront.
 */
export default function StorefrontEditorLoading() {
  return (
    <div className="flex min-h-screen flex-col bg-muted">
      <span className="sr-only">Loading the storefront editor…</span>

      {/* Toolbar strip */}
      <div
        aria-hidden="true"
        className="flex h-14 items-center gap-3 border-b border-border bg-background px-4"
      >
        <Skeleton className="h-8 w-8" />
        <Skeleton className="h-4 w-40" />
        <div className="ml-auto flex items-center gap-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>

      {/* Canvas + inspector rail */}
      <div aria-hidden="true" className="flex min-h-0 flex-1">
        <div className="flex flex-1 items-center justify-center p-8">
          <Skeleton className="aspect-square w-full max-w-xl rounded-md bg-background shadow-sm" />
        </div>
        <div className="hidden w-72 shrink-0 border-l border-border bg-background p-4 md:block">
          <div className="space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
