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
        <div className="h-8 w-8 animate-pulse rounded-sm bg-secondary motion-reduce:animate-none" />
        <div className="h-4 w-40 animate-pulse rounded-sm bg-secondary motion-reduce:animate-none" />
        <div className="ml-auto flex items-center gap-2">
          <div className="h-8 w-20 animate-pulse rounded-sm bg-secondary motion-reduce:animate-none" />
          <div className="h-8 w-24 animate-pulse rounded-sm bg-secondary motion-reduce:animate-none" />
        </div>
      </div>

      {/* Canvas + inspector rail */}
      <div aria-hidden="true" className="flex min-h-0 flex-1">
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="aspect-square w-full max-w-xl animate-pulse rounded-md bg-background shadow-sm motion-reduce:animate-none" />
        </div>
        <div className="hidden w-72 shrink-0 border-l border-border bg-background p-4 md:block">
          <div className="space-y-3">
            <div className="h-4 w-24 animate-pulse rounded-sm bg-secondary motion-reduce:animate-none" />
            <div className="h-9 w-full animate-pulse rounded-sm bg-secondary motion-reduce:animate-none" />
            <div className="h-9 w-full animate-pulse rounded-sm bg-secondary motion-reduce:animate-none" />
            <div className="h-24 w-full animate-pulse rounded-sm bg-secondary motion-reduce:animate-none" />
          </div>
        </div>
      </div>
    </div>
  );
}
