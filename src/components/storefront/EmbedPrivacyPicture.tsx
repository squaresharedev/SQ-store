import { Globe, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { BrowserChrome } from "@/components/ui/BrowserChrome";
import { cardClass, placeholderBarClass } from "@/components/ui/surface-styles";

/** Where a privacy policy usually lives on a site, for the drawn address bar.
 *  Illustrative only: the seller's may be elsewhere. */
const POLICY_PATH = "/privacy";

/**
 * The picture beside "Add this to your privacy policy": the privacy page of the
 * seller's OWN site, with one new paragraph going into it. Drawn in the same
 * vocabulary as the embed picture (EmbedHero), so the two read as one story:
 * the storefront goes on your site, and your site says so.
 *
 * Purely illustrative, so `aria-hidden`; the step's heading and text say it.
 */
export function EmbedPrivacyPicture({ domain }: { domain: string | undefined }) {
  return (
    <div aria-hidden="true" className={cn(cardClass, "overflow-hidden")}>
      <BrowserChrome>
        <Globe className="size-3 shrink-0" strokeWidth={2} />
        {domain ? (
          <span className="truncate text-foreground">
            {domain}
            <span className="text-muted-foreground">{POLICY_PATH}</span>
          </span>
        ) : (
          <span className={cn(placeholderBarClass, "w-24")} />
        )}
      </BrowserChrome>

      {/* The policy: a heading, its paragraphs, and the one being added. */}
      <div className="space-y-3 bg-muted/40 p-4">
        <span className={cn(placeholderBarClass, "block h-3 w-1/2 bg-muted-foreground/40")} />
        <div className="space-y-2">
          <span className={cn(placeholderBarClass, "block w-full")} />
          <span className={cn(placeholderBarClass, "block w-5/6")} />
        </div>
        <div className="flex items-start gap-2 rounded-sm border border-dashed border-success bg-background p-2">
          <Plus className="size-3.5 shrink-0 text-success" strokeWidth={2.5} />
          <div className="flex-1 space-y-1.5">
            <span className={cn(placeholderBarClass, "block w-full bg-success/40")} />
            <span className={cn(placeholderBarClass, "block w-2/3 bg-success/40")} />
          </div>
        </div>
        <div className="space-y-2">
          <span className={cn(placeholderBarClass, "block w-4/5")} />
          <span className={cn(placeholderBarClass, "block w-1/3")} />
        </div>
      </div>
    </div>
  );
}
