import { ArrowLeft } from "lucide-react";
import { iconNudgeLeftClass } from "@/components/ui/control-styles";

/**
 * Loading state for the product create/edit routes.
 *
 * It has to mirror ProductFormView's shell — same container width, same back
 * link, same heading block — because the alternative is what used to happen:
 * `products/loading.tsx` applies to every nested route, so opening a product
 * showed the PRODUCTS LIST skeleton (a grid of cards) and then snapped to a
 * form. A skeleton that predicts the wrong page is worse than none; it tells
 * the user they are going somewhere they are not.
 */

const shimmer = "animate-pulse rounded-sm bg-secondary motion-reduce:animate-none";

/** One labelled field: a short label bar above a control-height box. */
function FieldSkeleton({ control = "h-10" }: { control?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className={`h-3 w-24 ${shimmer}`} />
      <div className={`w-full ${control} ${shimmer}`} />
    </div>
  );
}

export function ProductFormSkeleton({ title }: { title: string }) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      {/* The back link is real, not a placeholder: it works immediately, and
          it is the one control a user might want while the form loads. */}
      <span className="inline-flex items-center gap-1.5 font-inter text-sm text-muted-foreground">
        <ArrowLeft className={`size-4 ${iconNudgeLeftClass}`} strokeWidth={2} aria-hidden="true" />
        Products
      </span>

      <div className="mb-8 mt-4">
        <h1 className="text-2xl font-semibold text-foreground md:text-3xl">{title}</h1>
        <div className={`mt-2 h-3 w-72 max-w-full ${shimmer}`} />
      </div>

      <div
        role="status"
        aria-label="Loading the product form"
        className="flex flex-col gap-6"
      >
        <FieldSkeleton />
        <FieldSkeleton control="h-28" />
        <div className="grid gap-6 sm:grid-cols-2">
          <FieldSkeleton />
          <FieldSkeleton />
        </div>
        {/* Display image: the 4:3 dropzone. */}
        <div className="flex flex-col gap-2">
          <div className={`h-3 w-28 ${shimmer}`} />
          <div className={`aspect-[4/3] w-full ${shimmer}`} />
        </div>
        <FieldSkeleton />
        <div className="border-t border-border pt-6">
          <div className="flex justify-end gap-3">
            <div className={`h-10 w-24 ${shimmer}`} />
            <div className={`h-10 w-32 ${shimmer}`} />
          </div>
        </div>
      </div>
    </main>
  );
}
