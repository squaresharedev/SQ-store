"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { EyeOff, Plus } from "lucide-react";
import { EmbedCodeIcon, useIconHoverProps } from "@/components/ui/action-icons";
import { Button } from "@/components/ui/button";
import {
  focusRingClass,
  helpTextClass,
  hoverLiftClass,
  iconButtonClass,
  iconPopClass,
  labelClass,
} from "@/components/ui/control-styles";
import { Modal } from "@/components/ui/modal";
import { cardClass } from "@/components/ui/surface-styles";
import { embedSnippet } from "@/lib/storefront/embed-snippet";
import {
  SAMPLE_PRODUCTS,
  SAMPLE_STOREFRONT_CONFIG,
  SAMPLE_STOREFRONT_NAME,
  SAMPLE_STOREFRONT_PATH,
} from "@/lib/storefront/sample";
import { cn } from "@/lib/utils";
import { StorefrontPreview } from "./StorefrontPreview";

const SAMPLE_PRODUCTS_BY_ID: ReadonlyMap<string, (typeof SAMPLE_PRODUCTS)[number]> = new Map(
  SAMPLE_PRODUCTS.map((product) => [product.id, product]),
);

/** What the embed dialog shows in place of a real key. The same stand-in the
 *  guided tour's embed stop uses, so the two never disagree. */
const SAMPLE_EMBED_KEY = "your-storefront-key";

/**
 * The sample storefront's card in the storefront list (lib/storefront/sample.ts).
 *
 * Laid out like StorefrontCard (a live miniature on top, the name under it,
 * icon actions in the corner, the whole card a link) so it reads as one of the
 * list, and marked "Sample" so it is never mistaken for the seller's own.
 * Its own component rather than StorefrontCard with a flag: the sample has no
 * row behind it, so it has no delete (it hides instead) and its embed button
 * explains the snippet rather than configuring one.
 *
 * `data-storefront-sample` is on the list item (StorefrontsList), where the
 * guided tour looks for it; the embed button keeps the `Embed <name>` label the
 * tour's embed stop finds on every card.
 */
export function SampleStorefrontCard({
  onEmbed,
  onHide,
  hiding = false,
}: {
  onEmbed: () => void;
  onHide: () => void;
  hiding?: boolean;
}) {
  const iconHover = useIconHoverProps();
  const blockCount = SAMPLE_STOREFRONT_CONFIG.blocks.length;

  return (
    <div className={cn(cardClass, "relative flex flex-col shadow-sm", hoverLiftClass)}>
      <Link
        href={SAMPLE_STOREFRONT_PATH}
        aria-label="Open the sample storefront"
        className={cn("absolute inset-0 z-10 rounded-md", focusRingClass)}
      />

      <div className="pointer-events-none relative z-0">
        <div aria-hidden="true" className="relative aspect-[4/3] w-full overflow-hidden rounded-t-md">
          <StorefrontPreview
            config={SAMPLE_STOREFRONT_CONFIG}
            productsById={SAMPLE_PRODUCTS_BY_ID}
          />
          {/* Opaque pill on the same terms as the empty-card hint: contrast
              holds on any canvas because it brings its own background. */}
          <span className="absolute left-3 top-3 rounded-full border border-border bg-background px-2.5 py-1 font-inter text-xs font-medium text-foreground shadow-xs">
            Sample
          </span>
        </div>
        <div className="mt-3 px-4 pb-4 pr-9">
          <h3 className="truncate text-base font-semibold text-foreground">
            {SAMPLE_STOREFRONT_NAME}
          </h3>
          <p className="mt-0.5 font-inter text-sm text-muted-foreground">
            {blockCount} blocks · try anything, nothing is saved
          </p>
        </div>
      </div>

      <div className="absolute right-3 top-3 z-20 flex gap-1.5">
        <motion.button
          type="button"
          onClick={onEmbed}
          aria-label={`Embed ${SAMPLE_STOREFRONT_NAME}`}
          className={cn(iconButtonClass, "hover:text-foreground")}
          {...iconHover}
        >
          <EmbedCodeIcon />
        </motion.button>
        <button
          type="button"
          onClick={onHide}
          disabled={hiding}
          aria-label="Hide the sample storefront"
          className={cn(iconButtonClass, "hover:text-foreground")}
        >
          <EyeOff className="size-4" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/**
 * What the sample card's embed button opens: what a snippet looks like and where
 * a real one comes from. No settings, because there is no storefront to embed.
 */
export function SampleEmbedModal({
  open,
  onClose,
  onCreate,
  canCreate,
}: {
  open: boolean;
  onClose: () => void;
  /** Opens the list's own setup flow. */
  onCreate: () => void;
  canCreate: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Embed a storefront"
      description="Every storefront you create gets its own snippet to paste into your website."
    >
      <div className="space-y-5">
        <div className="space-y-1.5">
          <span className={labelClass}>A snippet looks like this</span>
          <pre className="whitespace-pre-wrap break-all rounded-none border border-border bg-muted p-3 font-mono text-xs text-foreground">
            {embedSnippet(SAMPLE_EMBED_KEY)}
          </pre>
          <p className={helpTextClass}>
            The widget is still in development and doesn&apos;t show on other sites yet.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          {canCreate && (
            <Button onClick={onCreate}>
              <Plus className={cn("size-4", iconPopClass)} strokeWidth={2} aria-hidden="true" />
              Create a storefront
            </Button>
          )}
          <Button variant="secondary" onClick={onClose} className="sm:mr-auto">
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
