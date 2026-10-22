"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { usableCutout } from "@/components/share-card/parts";
import { SHARE_CARD_TEMPLATES, type ShareCardTemplateId } from "@/components/share-card/templates";
import type { ShareCardProduct } from "@/components/share-card/types";
import { ProductThumb } from "@/components/ui/ProductThumb";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Spinner } from "@/components/ui/spinner";
import { eyebrowClass } from "@/components/ui/surface-styles";
import type { Cutout } from "@/lib/share-card/cutout/engine";
import { MIN_MASK_CONFIDENCE } from "@/lib/share-card/cutout/refine";
import { requestCutout, useCutouts, type CutoutSnapshot } from "@/lib/share-card/cutout/store";
import {
  SHARE_CARD_EXPORT_SCALE,
  SHARE_CARD_FORMATS,
  SHARE_CARD_FORMAT_IDS,
  SHARE_CARD_WIDTH,
  type ShareCardFormat,
} from "@/lib/share-card/formats";
import { cn } from "@/lib/utils";

type GalleryProduct = ShareCardProduct & { id: string; note: string };

/** What the page lines up: one product in every template, or one template
 *  on every product (the way to see a template survive every case). */
const COMPARE = { templates: "Every template", products: "Every product" } as const;
type Compare = keyof typeof COMPARE;

/** Whether the product is cut out of its photo, or the photo is used as is:
 *  the second is what a card falls back to, and has to stand up too. */
const DEPTH = { cutout: "Cut out", photo: "Photo as is" } as const;
type Depth = keyof typeof DEPTH;

const MB = 1e6;

/** One product's cutout state, in words, for its picker button. */
function cutoutNote(product: GalleryProduct, snapshot: CutoutSnapshot): string | null {
  if (!product.photo) return null;
  const state = snapshot.photos.get(product.photo.key);
  if (!state) return null;
  if (state.status === "working") return "Cutting out…";
  if (state.status === "failed") return "Could not cut out: photo as is";
  if (state.cutout.confidence < MIN_MASK_CONFIDENCE) return "Not sure where it ends: photo as is";
  return usableCutout(state.cutout) ? "Cut out" : "Cropped in its photo: photo as is";
}

/** The engine's state, in words: the one-time download is the long wait. */
function engineNote(snapshot: CutoutSnapshot): string | null {
  const { engine } = snapshot;
  if (engine.phase === "loading") {
    const where = engine.device === "webgpu" ? "on the GPU" : "on the CPU (no usable WebGPU here, slower)";
    return engine.total > 0
      ? `Downloading the cut-out model, ${Math.round(engine.loaded / MB)} of ${Math.round(engine.total / MB)} MB, once for this browser. It will run ${where}.`
      : `Loading the cut-out model. It will run ${where}.`;
  }
  if (engine.phase === "failed") return `The cut-out model did not load: ${engine.message}`;
  return null;
}

/**
 * SHARE CARDS, on fixtures and on the signed-in seller's own products: each
 * template in each format, at the size it is laid out at (it exports at
 * SHARE_CARD_EXPORT_SCALE times that). The product is cut out of its photo
 * in this browser (lib/share-card/cutout); nothing is sent anywhere.
 */
export function ShareCardsGallery({ products }: { products: readonly GalleryProduct[] }) {
  const t = useTranslations("Products.shareCard");
  const [format, setFormat] = useState<ShareCardFormat>("portrait");
  const [compare, setCompare] = useState<Compare>("templates");
  const [depth, setDepth] = useState<Depth>("cutout");
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [templateId, setTemplateId] = useState<ShareCardTemplateId>("masthead");
  const snapshot = useCutouts();
  const product = products.find((candidate) => candidate.id === productId) ?? products[0];

  // Cut out what is on screen: the chosen product, or every one of them.
  useEffect(() => {
    if (depth !== "cutout") return;
    for (const each of compare === "templates" ? [product] : products) {
      if (each.photo) requestCutout(each.photo);
    }
  }, [depth, compare, product, products]);

  function cutoutOf(each: GalleryProduct): Cutout | null {
    if (depth !== "cutout" || !each.photo) return null;
    const state = snapshot.photos.get(each.photo.key);
    return state?.status === "ready" ? state.cutout : null;
  }
  function working(each: GalleryProduct): boolean {
    return depth === "cutout" && !!each.photo && snapshot.photos.get(each.photo.key)?.status === "working";
  }

  const exportSize = `${SHARE_CARD_WIDTH * SHARE_CARD_EXPORT_SCALE} x ${
    SHARE_CARD_FORMATS[format].height * SHARE_CARD_EXPORT_SCALE
  }`;
  const template = SHARE_CARD_TEMPLATES.find((candidate) => candidate.id === templateId) ?? SHARE_CARD_TEMPLATES[0];
  const cards =
    compare === "templates"
      ? SHARE_CARD_TEMPLATES.map(({ id, Component }) => ({
          key: id,
          caption: t(`templates.${id}`),
          busy: working(product),
          node: <Component product={product} format={format} cutout={cutoutOf(product)} />,
        }))
      : products.map((each) => ({
          key: each.id,
          caption: `${each.note}: ${each.title}`,
          busy: working(each),
          node: <template.Component product={each} format={format} cutout={cutoutOf(each)} />,
        }));
  const engine = engineNote(snapshot);

  return (
    <main
      className="min-h-screen bg-muted px-6 py-8 text-foreground"
      data-cutout-device={"device" in snapshot.engine ? snapshot.engine.device : undefined}
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <header className="flex flex-col gap-1">
          <h1 className="font-inter text-lg font-semibold">Share cards</h1>
          <p className="font-inter text-sm text-muted-foreground">
            A product drawn ready to post, cut out of its photo and set in front of type. Laid out at{" "}
            {SHARE_CARD_WIDTH} wide and exported at {SHARE_CARD_EXPORT_SCALE}x: this format comes out at {exportSize}{" "}
            pixels.
          </p>
        </header>

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedControl
              ariaLabel="Format"
              value={format}
              onChange={setFormat}
              options={SHARE_CARD_FORMAT_IDS.map((value) => ({
                value,
                label: `${t(`formats.${value}`)} ${SHARE_CARD_FORMATS[value].ratio}`,
              }))}
            />
            <SegmentedControl
              ariaLabel="Compare"
              value={compare}
              onChange={setCompare}
              options={(Object.keys(COMPARE) as Compare[]).map((value) => ({ value, label: COMPARE[value] }))}
            />
            <SegmentedControl
              ariaLabel="Product"
              value={depth}
              onChange={setDepth}
              options={(Object.keys(DEPTH) as Depth[]).map((value) => ({ value, label: DEPTH[value] }))}
            />
          </div>

          {engine && (
            <p role="status" data-cutout-engine={snapshot.engine.phase} className="flex items-center gap-2 font-inter text-sm text-muted-foreground">
              {snapshot.engine.phase === "loading" && <Spinner className="size-4" />}
              {engine}
            </p>
          )}

          {compare === "templates" ? (
            <fieldset className="flex flex-col gap-2">
              <legend className={cn(eyebrowClass, "mb-2")}>Product</legend>
              <div className="flex flex-wrap gap-2">
                {products.map((each) => {
                  const note = depth === "cutout" ? cutoutNote(each, snapshot) : null;
                  return (
                    <button
                      key={each.id}
                      type="button"
                      aria-pressed={each.id === product.id}
                      onClick={() => setProductId(each.id)}
                      className={cn(
                        "flex max-w-60 items-center gap-2 border bg-background p-1.5 pr-3 text-left",
                        each.id === product.id ? "border-foreground" : "border-border hover:border-foreground/40",
                      )}
                    >
                      <ProductThumb src={each.imageUrl} className="size-9" />
                      <span className="min-w-0">
                        <span className="block font-inter text-xs text-muted-foreground">{each.note}</span>
                        <span className="block truncate text-sm font-medium">{each.title}</span>
                        {note && (
                          <span data-cutout-note className="block truncate font-inter text-xs text-muted-foreground">
                            {note}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ) : (
            <SegmentedControl
              ariaLabel="Template"
              value={templateId}
              onChange={setTemplateId}
              options={SHARE_CARD_TEMPLATES.map(({ id }) => ({ value: id, label: t(`templates.${id}`) }))}
            />
          )}
        </div>

        <div className="flex flex-wrap gap-8" data-share-gallery={compare}>
          {cards.map((card) => (
            <figure key={card.key} className="flex flex-col gap-2" data-share-template={card.key}>
              <div className="relative shadow-md">
                {card.node}
                {card.busy && (
                  <span className="absolute right-2 top-2 flex items-center gap-1.5 bg-background/90 px-2 py-1 font-inter text-xs text-foreground shadow-sm">
                    <Spinner className="size-3.5" />
                    Cutting out…
                  </span>
                )}
              </div>
              {/* w-0 min-w-full: as wide as the card, never wider. */}
              <figcaption className="w-0 min-w-full truncate font-inter text-sm text-muted-foreground">
                {card.caption}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </main>
  );
}
